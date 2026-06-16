import { FileSession } from "./fileSession"
export { FileSession }

const AUTH_TOKEN = "okzxc123"; // 你的 Token

// HTML 网页源码，直接嵌入到 Worker 中（最适合独立 Worker 部署的方案）
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Cloudflare 文件管理</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --bg: #f6f7f9;
      --card: #ffffff;
      --primary: #0051ff;
      --danger: #e5484d;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #e5e7eb;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
    }

    .container {
      max-width: 820px;
      margin: 40px auto;
      padding: 0 16px;
    }

    h1 {
      font-size: 24px;
      margin-bottom: 16px;
    }

    .card {
      background: var(--card);
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.04);
    }

    label {
      display: block;
      font-size: 14px;
      margin-bottom: 6px;
      color: var(--muted);
    }

    input[type="text"],
    input[type="file"] {
      width: 100%;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      font-size: 14px;
    }

    button {
      margin-top: 12px;
      padding: 10px 16px;
      border-radius: 6px;
      border: none;
      background: var(--primary);
      color: #fff;
      font-size: 14px;
      cursor: pointer;
    }

    button:disabled {
      background: #a5b4fc;
      cursor: not-allowed;
    }

    .status {
      margin-top: 10px;
      font-size: 14px;
    }

    .success { color: #16a34a; }
    .error { color: var(--danger); }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th, td {
      padding: 10px;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }

    th {
      color: var(--muted);
      font-weight: 500;
    }

    .actions button {
      background: transparent;
      color: var(--danger);
      padding: 0;
      margin: 0;
    }

    .progress {
      height: 6px;
      background: #e5e7eb;
      border-radius: 3px;
      overflow: hidden;
      margin-top: 10px;
    }

    .progress div {
      height: 100%;
      background: var(--primary);
      width: 0%;
      transition: width .2s;
    }
    
    a {
      color: var(--primary);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
<div class="container">
  <h1>📁 Cloudflare 边缘文件管理</h1>

  <div class="card">
    <label>访问 Token</label>
    <input id="tokenInput" type="text" placeholder="请输入 Token" />
    <button id="verifyBtn" onclick="verifyToken()">验证 Token</button>
    <div id="authStatus" class="status"></div>
  </div>

  <div class="card" id="uploadCard" style="display:none">
    <label>选择文件（分片上传，支持大文件）</label>
    <input type="file" id="fileInput" />
    <button id="uploadBtn" onclick="upload()">上传文件</button>
    <div class="progress"><div id="progressBar"></div></div>
    <div id="uploadStatus" class="status"></div>
  </div>

  <div class="card" id="filesCard" style="display:none">
    <h3>文件列表 (点击文件名即可下载)</h3>
    <table>
      <thead>
        <tr>
          <th>文件名</th>
          <th>大小</th>
          <th>上传时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="fileList"></tbody>
    </table>
  </div>
</div>

<script>
  // 保持与后端 Worker 一致，每片 5MB
  const chunkSize = 5 * 1024 * 1024 
  let token = sessionStorage.getItem('token')

  // 初始化检查本地是否存有 Token
  if (token) {
    document.getElementById('tokenInput').value = token
    unlock()
  }

  // 验证 Token 并在成功后解锁界面
  async function verifyToken() {
    const tokenInput = document.getElementById('tokenInput')
    const authStatus = document.getElementById('authStatus')
    const t = tokenInput.value.trim()
    
    if (!t) {
      authStatus.textContent = '请输入 Token'
      authStatus.className = 'status error'
      return
    }

    try {
      const res = await fetch('/files', {
        headers: { Authorization: 'Bearer ' + t }
      })

      if (res.ok) {
        token = t
        sessionStorage.setItem('token', token)
        unlock()
        authStatus.textContent = '鉴权成功'
        authStatus.className = 'status success'
      } else {
        authStatus.textContent = 'Token 无效或权限不足 (' + res.status + ')'
        authStatus.className = 'status error'
      }
    } catch (err) {
      authStatus.textContent = '连接服务器失败'
      authStatus.className = 'status error'
    }
  }

  // 解锁上传和列表卡片
  function unlock() {
    document.getElementById('uploadCard').style.display = ''
    document.getElementById('filesCard').style.display = ''
    loadFiles()
  }

  // 分片上传主函数
  async function upload() {
    const fileInput = document.getElementById('fileInput')
    const uploadStatus = document.getElementById('uploadStatus')
    const progressBar = document.getElementById('progressBar')
    const uploadBtn = document.getElementById('uploadBtn')
    
    const file = fileInput.files[0]
    if (!file) {
      uploadStatus.textContent = '请先选择文件'
      uploadStatus.className = 'status error'
      return
    }

    uploadBtn.disabled = true
    uploadStatus.textContent = '正在初始化上传任务...'
    uploadStatus.className = 'status'
    progressBar.style.width = '0%'

    try {
      // 1. 请求初始化分片任务 (对接 Worker，传递精确的 name, size, type)
      const initRes = await fetch('/upload/init', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          name: file.name, 
          size: file.size,
          type: file.type || 'application/octet-stream'
        })
      })

      if (!initRes.ok) throw new Error('初始化上传失败')
      const init = await initRes.json()

      // 2. 循环切片并串行上传
      for (let i = 0; i < init.chunks; i++) {
        uploadStatus.textContent = `正在上传分片 (${i + 1}/${init.chunks})...`
        
        const chunk = file.slice(i * chunkSize, (i + 1) * chunkSize)
        
        // 将凭证通过 URL Query 传递，避免后端反复解析复合多媒体数据包造成的内存膨胀
        const chunkRes = await fetch(`/upload/chunk?uploadId=${init.uploadId}&index=${i}`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token
            // 注意：发送 FormData 时切勿手动设置 Content-Type 头，让浏览器自动追随 boundary
          },
          body: (() => {
            const f = new FormData()
            f.append('chunk', chunk, file.name)
            return f
          })()
        })

        if (!chunkRes.ok) throw new Error(`分片 ${i + 1} 上传失败`)

        // 更新进度条
        progressBar.style.width = `${((i + 1) / init.chunks) * 100}%`
      }

      // 3. 通知后端合拢分片并归档
      uploadStatus.textContent = '正在完成文件归档...'
      const completeRes = await fetch('/upload/complete', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uploadId: init.uploadId })
      })

      if (!completeRes.ok) throw new Error('归档失败')

      uploadStatus.textContent = '上传成功！'
      uploadStatus.className = 'status success'
      fileInput.value = '' // 清空选择器
      loadFiles() // 刷新列表

    } catch (err) {
      uploadStatus.textContent = '错误: ' + err.message
      uploadStatus.className = 'status error'
    } finally {
      uploadBtn.disabled = false
    }
  }

  // 加载存储中的文件列表
  async function loadFiles() {
    const fileList = document.getElementById('fileList')
    try {
      const res = await fetch('/files', {
        headers: { Authorization: 'Bearer ' + token }
      })
      if (!res.ok) return

      const data = await res.json()
      fileList.innerHTML = ''

      const entries = Object.entries(data)
      if (entries.length === 0) {
        fileList.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);">暂无文件</td></tr>'
        return
      }

      entries.forEach(([id, f]) => {
        const tr = document.createElement('tr')
        // 文件名修改为超链接，支持直接下载
        tr.innerHTML = `
          <td><a href="/download/${id}" target="_blank" rel="noopener noreferrer">📄 ${f.fileName || f.name}</a></td>
          <td>${((f.size || 0) / 1024 / 1024).toFixed(2)} MB</td>
          <td>${f.createdAt ? new Date(f.createdAt * 1000).toLocaleString() : '未知'}</td>
          <td class="actions">
            <button onclick="del('${id}')">删除</button>
          </td>`
        fileList.appendChild(tr)
      })
    } catch (err) {
      fileList.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--danger);">加载列表失败</td></tr>'
    }
  }

  // 删除文件逻辑
  async function del(id) {
    if (!confirm('确认要永久删除这个文件吗？')) return
    try {
      const res = await fetch('/delete/' + id, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      })
      if (res.ok) {
        loadFiles()
      } else {
        alert('删除失败')
      }
    } catch (err) {
      alert('网络错误，删除失败')
    }
  }
</script>
</body>
</html>
`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // 【新增逻辑】如果访问根路径、/index.html 或者你原本测试的路径，直接返回网页
    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/pages/index.html") {
      return new Response(HTML_CONTENT, {
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
      const fileId = crypto.randomUUID();
      
      const chunkSize = 5 * 1024 * 1024;
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
        await stub.fetch("https://do/delete", { method: "POST" });
        delete list[fileId];
        await env.FILE_KV.put("INDEX_FILES", JSON.stringify(list));
      }
      return Response.json({ success: true });
    }

    return new Response("Not Found", { status: 404 });
  }
}