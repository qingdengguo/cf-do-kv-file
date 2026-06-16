import { FileSession } from "./fileSession"
import htmlContent from "../pages/index.html"

export { FileSession }

const AUTH_TOKEN = "okzxc123"; // 你的 Token

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

	// 如果访问网页路径，直接返回导入的 htmlContent
    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/pages/index.html") {
      return new Response(htmlContent, {
        headers: { "Content-Type": "text/html; charset=UTF-8" }
      });
    }

    // 1. 简单的 Token 鉴权中间件 (下载接口和首页除外)
    // 修复了之前的 || 逻辑 Bug，改为精确拦截 API 请求
    if (
      url.pathname !== "/" && 
      url.pathname !== "/index.html" && 
      url.pathname !== "/pages/index.html" && 
      !url.pathname.startsWith("/download/")
    ) {
      const auth = req.headers.get("Authorization");
      if (!auth || auth !== `Bearer ${AUTH_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // 2. 模拟获取文件列表
    if (req.method === "GET" && url.pathname === "/files") {
      const list = await env.FILE_KV.get("INDEX_FILES") || "{}";
      return new Response(list, { headers: { "Content-Type": "application/json" } });
    }

    // 3. 初始化上传
    if (req.method === "POST" && url.pathname === "/upload/init") {
      const { name, size, type } = await req.json();
      const fileId = name;
      
      const chunkSize =  * 1024 * 1024;
      const totalChunks = Math.ceil(size / chunkSize);

      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(fileId));

      await stub.fetch("https://do/init", {
        method: "POST",
        body: JSON.stringify({ fileName: name, totalChunks, type, size, fileId })
      });

      return Response.json({ uploadId: fileId, chunks: totalChunks });
    }

    // 4. 上传分片
    if (req.method === "POST" && url.pathname === "/upload/chunk") {
      const uploadId = url.searchParams.get("uploadId");
      const index = url.searchParams.get("index");

      if (!uploadId || index === null) return new Response("Missing params", { status: 400 });

      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
      return stub.fetch(`https://do/chunk?index=${index}`, req);
    }

    // 5. 完成上传
    if (req.method === "POST" && url.pathname === "/upload/complete") {
      const { uploadId } = await req.json();
      const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(uploadId));
      
      const res = await stub.fetch("https://do/complete", { method: "POST" });
      if (!res.ok) return res;

      const meta = await res.json();
      const list = JSON.parse(await env.FILE_KV.get("INDEX_FILES") || "{}");
      list[uploadId] = meta;
      await env.FILE_KV.put("INDEX_FILES", JSON.stringify(list));

      return Response.json({ success: true });
    }

    // 6. 下载文件
	if (req.method === "GET" && url.pathname.startsWith("/download/")) {
	  // 提取出 URL 里的文件名，并进行解码（防止中文变成 %E4%BD%A0）
	  const encodedName = url.pathname.split("/").pop();
	  const fileName = decodeURIComponent(encodedName); 

	  if (!fileName) return new Response("Missing filename", { status: 400 });

	  // 🌟 核心修改：直接用【文件名】去获取或激活对应的 Durable Object 实例
	  const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(fileName));
	  return stub.fetch("https://do/download");
	}

    // 7. 删除文件
    if (req.method === "POST" && url.pathname.startsWith("/delete/")) {
      const fileId = url.pathname.split("/").pop();
      const list = JSON.parse(await env.FILE_KV.get("INDEX_FILES") || "{}");
      
      if (list[fileId]) {
        const stub = env.FILE_SESSION.get(env.FILE_SESSION.idFromName(fileId));
        await stub.fetch("https://do/delete", { method: "POST" });
        delete list[fileId];
        await env.FILE_KV.put("INDEX_FILES", JSON.stringify(list));
      }
      return Response.json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  }
}