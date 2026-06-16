export class FileSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/init") {
      const meta = await req.json();
      await this.state.storage.put("meta", meta);
      return new Response("OK");
    }

	if (url.pathname === "/chunk") {
	  const index = url.searchParams.get("index");
	  const meta = await this.state.storage.get("meta");
	  
	  // 🌟 因为前端直接传的二进制，所以这里直接拿 arrayBuffer，拿到的就是最纯净的文件碎片！
	  const buf = await req.arrayBuffer(); 
	  
	  const key = `file:${meta.fileId}:${index}`;
	  await this.env.FILE_KV.put(key, buf);
	  return new Response("OK");
	}

    if (url.pathname === "/complete") {
      const meta = await this.state.storage.get("meta");
      meta.createdAt = Math.floor(Date.now() / 1000);
      await this.state.storage.put("meta", meta);
      await this.state.storage.put("completed", true);
      
      // 把最新的元数据返回给 Worker 建立全局索引
      return Response.json(meta);
    }

    if (url.pathname === "/download") {
      const meta = await this.state.storage.get("meta");
      const completed = await this.state.storage.get("completed");
      if (!completed || !meta) return new Response("File not ready or found", { status: 404 });

      // 使用流式响应（Streams）拼接 KV 分片
      const env = this.env;
      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < meta.totalChunks; i++) {
            const key = `file:${meta.fileId}:${i}`;
            const chunk = await env.FILE_KV.get(key, { type: "arrayBuffer" });
            if (chunk) {
              controller.enqueue(new Uint8Array(chunk));
            }
          }
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": meta.type || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(meta.fileName)}"`,
          "Content-Length": meta.size
        }
      });
    }

    if (url.pathname === "/delete") {
      const meta = await this.state.storage.get("meta");
      if (meta) {
        // 清理 KV 中的所有分片
        for (let i = 0; i < meta.totalChunks; i++) {
          await this.env.FILE_KV.delete(`file:${meta.fileId}:${i}`);
        }
      }
      await this.state.storage.deleteAll(); // 清空 DO 自身状态
      return new Response("Deleted");
    }

    return new Response("404", { status: 404 });
  }
}