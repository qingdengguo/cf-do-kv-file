export class FileSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);

    // 初始化任务状态
    if (url.pathname === "/init") {
      const meta = await req.json();
      await this.state.storage.put("meta", meta);
      return new Response("OK");
    }

    // 处理二进制分片（核心修改部分）
    if (url.pathname === "/chunk") {
      const index = url.searchParams.get("index");
      const meta = await this.state.storage.get("meta");
      if (!meta) return new Response("Session Not Found", { status: 404 });
      
      // 🌟 核心改进：前端发来的是纯二进制流，直接转为 ArrayBuffer
      const buf = await req.arrayBuffer(); 
      
      // 以 "file:唯一ID:分片序号" 命名，杜绝同名文件覆盖 Bug
      const key = `file:${meta.fileId}:${index}`;
      await this.env.FILE_KV.put(key, buf);
      return new Response("OK");
    }

    // 完成上传并归档
    if (url.pathname === "/complete") {
      const meta = await this.state.storage.get("meta");
      if (!meta) return new Response("Session Not Found", { status: 404 });
      
      meta.createdAt = Math.floor(Date.now() / 1000);
      await this.state.storage.put("meta", meta);
      await this.state.storage.put("completed", true);
      
      return Response.json(meta);
    }

    // 拼接分片并提供下载
    if (url.pathname === "/download") {
      const meta = await this.state.storage.get("meta");
      const completed = await this.state.storage.get("completed");
      if (!completed || !meta) return new Response("File Not Ready", { status: 404 });

      const env = this.env;
      
      // 使用边缘流（ReadableStream）按顺序把 KV 里的分片拼接吐出
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
          // 对文件名进行编码防止中文乱码，触发流式附件下载
          "Content-Disposition": `attachment; filename="${encodeURIComponent(meta.fileName)}"`,
          "Content-Length": meta.size
        }
      });
    }

    // 删除并清理
    if (url.pathname === "/delete") {
      const meta = await this.state.storage.get("meta");
      if (meta) {
        // 循环擦除该文件在 KV 中占用的每一块内存分片
        for (let i = 0; i < meta.totalChunks; i++) {
          await this.env.FILE_KV.delete(`file:${meta.fileId}:${i}`);
        }
      }
      await this.state.storage.deleteAll(); // 清空该 DO 自身的数据
      return new Response("Deleted");
    }

    return new Response("404", { status: 404 });
  }
}