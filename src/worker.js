import { FileSession } from "./fileSession"
export { FileSession }

const AUTH_TOKEN = "okzxc123"; // 全局访问凭证（可根据需要修改）

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // 1. 严格的 Token 鉴权中间件 (首页和下载路由除外)
    if (
      url.pathname !== "/" && 
      url.pathname !== "/index.html" && 
      !url.pathname.startsWith("/download/")
    ) {
      const auth = req.headers.get("Authorization");
      if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // 2. 获取已成功上传的文件列表
    if (req.method === "GET" && url.pathname === "/files") {
      const list = await env.FILE_KV.get("INDEX_FILES") || "{}";
      return new Response(list, { headers: { "Content-Type": "application/json" } });
    }

    // 3. 初始化上传任务
    if (req.method === "POST" && url.pathname === "/upload/init") {
      const { name, size, type } = await req.json();
      const uploadId = crypto.randomUUID(); // 为该文件生成唯一 ID
      
      const chunkSize = 5 * 1024 * 1024; // 每片 5MB
      const totalChunks = Math.ceil(size / chunkSize);

      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));

      // 将元数据存入该文件对应的 DO 实例中
      await stub.fetch("https://do/init", {
        method: "POST",
        body: JSON.stringify({ fileName: name, totalChunks, type, size, fileId: uploadId })
      });

      return Response.json({ uploadId, chunks: totalChunks });
    }

    // 4. 上传分片 (直接透传给相应的 DO 实例进行处理)
    if (req.method === "POST" && url.pathname === "/upload/chunk") {
      const uploadId = url.searchParams.get("uploadId");
      const index = url.searchParams.get("index");

      if (!uploadId || index === null) return new Response("Missing params", { status: 400 });

      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
      return stub.fetch(`https://do/chunk?index=${index}`, req);
    }

    // 5. 完成上传任务并归档索引
    if (req.method === "POST" && url.pathname === "/upload/complete") {
      const { uploadId } = await req.json();
      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
      
      const res = await stub.fetch("https://do/complete", { method: "POST" });
      if (!res.ok) return res;

      // 归档：将该文件的基础元数据合并到主全局索引中
      const meta = await res.json();
      const list = JSON.parse(await env.FILE_KV.get("INDEX_FILES") || "{}");
      list[uploadId] = meta;
      await env.FILE_KV.put("INDEX_FILES", JSON.stringify(list));

      return Response.json({ success: true });
    }

    // 6. 下载文件 (使用 DO 内置流式响应)
    if (req.method === "GET" && url.pathname.startsWith("/download/")) {
      const uploadId = url.pathname.split("/").pop();
      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
      return stub.fetch("https://do/download");
    }

    // 7. 删除文件
    if (req.method === "POST" && url.pathname.startsWith("/delete/")) {
      const uploadId = url.pathname.split("/").pop();
      const list = JSON.parse(await env.FILE_KV.get("INDEX_FILES") || "{}");
      
      if (list[uploadId]) {
        const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
        await stub.fetch("https://do/delete", { method: "POST" }); // 释放空间
        delete list[uploadId];
        await env.FILE_KV.put("INDEX_FILES", JSON.stringify(list));
      }
      return Response.json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  }
}