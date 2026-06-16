import { FileSession } from "./fileSession"
export { FileSession }

const AUTH_TOKEN = "okqazzxc123"; // 示例 Token

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // 1. 简单的 Token 鉴权中间件 (下载接口除外)
    if (url.pathname !== "/" && !url.pathname.startsWith("/download/")) {
      const auth = req.headers.get("Authorization");
      if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // 2. 模拟获取文件列表 (实际可以从 KV 的前缀列出，这里从文件索引 KV 读取)
    if (req.method === "GET" && url.pathname === "/files") {
      const list = await env.FILE_KV.get("INDEX_FILES") || "{}";
      return new Response(list, { headers: { "Content-Type": "application/json" } });
    }

    // 3. 初始化上传
    if (req.method === "POST" && url.pathname === "/upload/init") {
      const { name, size, type } = await req.json();
      const fileId = crypto.randomUUID();
      
      // 这里的 chunkSize 必须和前端的 5MB 一致
      const chunkSize = 5 * 1024 * 1024;
      const totalChunks = Math.ceil(size / chunkSize);

      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(fileId));

      await stub.fetch("https://do/init", {
        method: "POST",
        body: JSON.stringify({ fileName: name, totalChunks, type, size, fileId })
      });

      // 返回前端需要的字段
      return Response.json({ uploadId: fileId, chunks: totalChunks });
    }

    // 4. 上传分片 (改用 URL Query 传参，避免 Worker 解析 FormData 的性能损耗)
    if (req.method === "POST" && url.pathname === "/upload/chunk") {
      const uploadId = url.searchParams.get("uploadId");
      const index = url.searchParams.get("index");

      if (!uploadId || index === null) return new Response("Missing params", { status: 400 });

      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
      // 直接把含有二进制文件的请求发给 DO
      return stub.fetch(`https://do/chunk?index=${index}`, req);
    }

    // 5. 完成上传
    if (req.method === "POST" && url.pathname === "/upload/complete") {
      const { uploadId } = await req.json();
      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
      
      const res = await stub.fetch("https://do/complete", { method: "POST" });
      if (!res.ok) return res;

      // 将成功的文件元数据写入全局列表索引
      const meta = await res.json();
      const list = JSON.parse(await env.FILE_KV.get("INDEX_FILES") || "{}");
      list[uploadId] = meta;
      await env.FILE_KV.put("INDEX_FILES", JSON.stringify(list));

      return Response.json({ success: true });
    }

    // 6. 下载文件
    if (req.method === "GET" && url.pathname.startsWith("/download/")) {
      const fileId = url.pathname.split("/").pop();
      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(fileId));
      return stub.fetch("https://do/download");
    }

    // 7. 删除文件
    if (req.method === "POST" && url.pathname.startsWith("/delete/")) {
      const fileId = url.pathname.split("/").pop();
      const list = JSON.parse(await env.FILE_KV.get("INDEX_FILES") || "{}");
      
      if (list[fileId]) {
        const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(fileId));
        await stub.fetch("https://do/delete", { method: "POST" }); // 通知 DO 释放空间
        delete list[fileId];
        await env.FILE_KV.put("INDEX_FILES", JSON.stringify(list));
      }
      return Response.json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  }
}