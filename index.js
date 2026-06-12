#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import clipboardy from "clipboardy";
import ora from "ora";
import { createInterface } from "readline";
import { stdin, stdout } from "process";
import { createServer } from "http";
import {
  readFile,
  stat,
  readdir,
  mkdir,
  writeFile,
  unlink,
  rmdir,
  rename,
} from "fs/promises";
import { join, extname, resolve, dirname } from "path";
import { existsSync } from "fs";
import { networkInterfaces } from "os";

class StaticFileServer {
  #readline;
  #httpServer = null;
  #port = 3000;
  #publicDir = "./public";

  #allowedFileTypes = [
    ".txt",
    ".js",
    ".html",
    ".css",
    ".json",
    ".md",
    ".xml",
    ".jpg",
    ".png",
    ".gif",
    ".svg",
  ];
  #maxFileSize = 10 * 1024 * 1024;
  #restrictedPaths = ["node_modules", ".git", ".env"];

  constructor(options = {}) {
    this.#port = options.port || 3000;
    this.#publicDir = options.directory || "./public";
    this.#readline = createInterface({ input: stdin, output: stdout });
    this.#readline.on("close", () => {
      console.log(chalk.gray("Exiting CLI..."));
      process.exit(0);
    });
  }

  #prompt(promptMessage) {
    return new Promise((resolve) =>
      this.#readline.question(promptMessage, resolve),
    );
  }

  #getContentType(ext) {
    const types = {
      ".html": "text/html",
      ".htm": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".xml": "application/xml",
    };
    return types[ext] || "application/octet-stream";
  }

  #formatFileSize(bytes) {
    if (bytes === 0) return "0 KB";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  #getFileIcon(filename, isDirectory) {
    if (isDirectory) return "folder";
    const ext = extname(filename).toLowerCase();
    const icons = {
      ".js": "javascript",
      ".html": "html",
      ".css": "css",
      ".json": "json",
      ".txt": "document",
      ".jpg": "image",
      ".png": "image",
      ".pdf": "pdf",
      ".zip": "archive",
    };
    return icons[ext] || "file";
  }

  #isValidFilePath(filePath) {
    const normalized = resolve(filePath);
    const publicResolved = resolve(this.#publicDir);
    if (!normalized.startsWith(publicResolved)) return false;
    for (const restricted of this.#restrictedPaths) {
      if (normalized.includes(restricted)) return false;
    }
    return true;
  }

  #isAllowedFileType(filename) {
    const ext = extname(filename).toLowerCase();
    return this.#allowedFileTypes.includes(ext);
  }

  #escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async #generateUI(currentPath = "") {
    const fullPath = join(this.#publicDir, currentPath);

    if (!existsSync(fullPath)) {
      await mkdir(fullPath, { recursive: true });
    }

    let items = [];
    try {
      items = await readdir(fullPath, { withFileTypes: true });
    } catch (err) {
      items = [];
    }

    items.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    let itemsHtml = "";

    // Breadcrumb
    const pathParts = currentPath.split("/").filter((p) => p);
    let breadcrumbHtml = `<li class="breadcrumb-item"><a href="/" class="breadcrumb-link"><i class="bi bi-house-door"></i> Home</a></li>`;

    let accumulatedPath = "";
    for (const part of pathParts) {
      accumulatedPath += (accumulatedPath ? "/" : "") + part;
      breadcrumbHtml += `<li class="breadcrumb-item"><a href="/~/${encodeURIComponent(accumulatedPath)}" class="breadcrumb-link">${this.#escapeHtml(part)}</a></li>`;
    }

    if (items.length === 0) {
      itemsHtml = `
        <div class="empty-state">
          <div class="empty-icon-wrapper"><i class="bi bi-folder2-open"></i></div>
          <h3>This folder is empty</h3>
          <p class="text-muted">Create a new file or folder to get started</p>
          <div class="empty-actions">
            <button class="empty-action-btn" onclick="showCreateFileModal()"><i class="bi bi-file-earmark-plus"></i> New File</button>
            <button class="empty-action-btn" onclick="showCreateFolderModal()"><i class="bi bi-folder-plus"></i> New Folder</button>
          </div>
        </div>`;
    } else {
      for (const item of items) {
        const itemName = item.name;
        const itemPath = currentPath ? currentPath + "/" + itemName : itemName;
        const itemFullPath = join(fullPath, itemName);

        let stats;
        try {
          stats = await stat(itemFullPath);
        } catch (err) {
          continue;
        }

        const size = item.isDirectory() ? "" : this.#formatFileSize(stats.size);
        const modified = stats.mtime.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const icon = this.#getFileIcon(itemName, item.isDirectory());
        const isImage =
          !item.isDirectory() &&
          [".jpg", ".jpeg", ".png", ".gif", ".svg"].includes(
            extname(itemName).toLowerCase(),
          );

        const iconMap = {
          folder: "bi-folder2",
          file: "bi-file-earmark",
          html: "bi-filetype-html",
          css: "bi-filetype-css",
          javascript: "bi-filetype-js",
          json: "bi-filetype-json",
          image: "bi-file-earmark-image",
          pdf: "bi-file-earmark-pdf",
          archive: "bi-file-earmark-zip",
          document: "bi-file-earmark-text",
        };

        const iconColorMap = {
          folder: "#f59e0b",
          html: "#e44d26",
          css: "#2563eb",
          javascript: "#eab308",
          json: "#f59e0b",
          image: "#10b981",
          pdf: "#ef4444",
          archive: "#8b5cf6",
          document: "#6b7280",
          file: "#6b7280",
        };

        const folderHref = "/~/" + encodeURIComponent(itemPath);
        const fileHref = "/f/" + encodeURIComponent(itemPath);
        const href = item.isDirectory() ? folderHref : fileHref;

        itemsHtml += `
          <div class="file-item" data-path="${this.#escapeHtml(itemPath)}" data-type="${item.isDirectory() ? "folder" : "file"}">
            <div class="file-check-wrapper">
              <input type="checkbox" class="file-checkbox" value="${this.#escapeHtml(itemPath)}">
            </div>
            <div class="file-icon-wrapper" style="color: ${iconColorMap[icon] || "#6b7280"}; background: ${iconColorMap[icon] || "#6b7280"}15;">
              <i class="bi ${iconMap[icon] || "bi-file-earmark"}"></i>
            </div>
            <div class="file-info" data-href="${this.#escapeHtml(href)}">
              <div class="file-name">
                <span class="file-link">${this.#escapeHtml(itemName)}</span>
                ${!item.isDirectory() && isImage ? '<span class="file-tag">image</span>' : ""}
              </div>
              <div class="file-meta">
                ${size ? `<span><i class="bi bi-hdd-stack"></i> ${size}</span>` : '<span><i class="bi bi-folder"></i> Folder</span>'}
                <span><i class="bi bi-clock"></i> ${modified}</span>
              </div>
            </div>
            <div class="file-actions">
              ${
                !item.isDirectory() && this.#isAllowedFileType(itemName)
                  ? `
                <button class="icon-btn edit-btn" data-file="${this.#escapeHtml(itemPath)}" title="Edit">
                  <i class="bi bi-pencil-square"></i>
                </button>`
                  : ""
              }
              <button class="icon-btn rename-btn" data-path="${this.#escapeHtml(itemPath)}" title="Rename">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="icon-btn delete-btn" data-path="${this.#escapeHtml(itemPath)}" data-type="${item.isDirectory() ? "folder" : "file"}" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>`;
      }
    }

    const currentPathJson = JSON.stringify(currentPath);
    const allowedExtsJson = JSON.stringify(this.#allowedFileTypes);
    const maxSize = this.#maxFileSize;
    const itemsCount = items.length;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${currentPath ? this.#escapeHtml(currentPath) : "Home"} - Peek Explorer</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
<style>
:root{--font-inter:'Inter',system-ui,-apple-system,sans-serif;--text-primary:#0f172a;--text-secondary:#475569;--text-muted:#94a3b8;--border-color:#e2e8f0;--accent:#3b82f6;--accent-hover:#2563eb;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-xl:20px;--shadow-sm:0 1px 2px 0 rgb(0 0 0 / 0.05);--shadow-md:0 4px 6px -1px rgb(0 0 0 / 0.1);--shadow-xl:0 20px 25px -5px rgb(0 0 0 / 0.1)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font-inter);background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;-webkit-font-smoothing:antialiased}
.app-shell{width:100%;max-width:1280px;background:rgba(255,255,255,0.98);backdrop-filter:blur(20px);border-radius:var(--radius-xl);box-shadow:var(--shadow-xl);overflow:hidden;display:flex;flex-direction:column;max-height:90vh}
.app-header{background:#fff;border-bottom:1px solid var(--border-color)}
.header-top{padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f1f5f9}
.app-brand{display:flex;align-items:center;gap:0.75rem;font-size:1.125rem;font-weight:700;color:var(--text-primary)}
.brand-icon{width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem}
.header-btn{width:36px;height:36px;border:1px solid var(--border-color);background:#fff;border-radius:var(--radius-sm);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);transition:all 0.2s}
.header-btn:hover{background:#f8fafc;border-color:#cbd5e1}
.nav-bar{padding:0.75rem 1.5rem;display:flex;align-items:center;gap:0.75rem}
.nav-btn{width:34px;height:34px;border:none;background:transparent;border-radius:var(--radius-sm);cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;font-size:1.1rem;transition:all 0.15s}
.nav-btn:hover{background:#f1f5f9;color:var(--text-primary)}
.address-bar{flex:1;display:flex;align-items:center;gap:0.5rem;background:#f8fafc;border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:0.5rem 0.875rem;font-size:0.8125rem;color:var(--text-secondary);overflow:hidden}
.address-bar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.address-bar i{color:var(--text-muted);flex-shrink:0}
.search-wrapper{position:relative;width:240px;flex-shrink:0}
.search-wrapper i{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:0.875rem;pointer-events:none}
.search-input{width:100%;padding:0.5rem 0.75rem 0.5rem 2.25rem;background:#f8fafc;border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.8125rem;font-family:var(--font-inter);outline:none;transition:all 0.2s}
.search-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,0.1);background:#fff}
.toolbar{padding:0.5rem 1.5rem;display:flex;gap:0.5rem;border-top:1px solid #f1f5f9;flex-wrap:wrap}
.tool-btn{padding:0.5rem 1rem;border:1px solid var(--border-color);background:#fff;border-radius:var(--radius-sm);cursor:pointer;font-size:0.8125rem;font-weight:500;font-family:var(--font-inter);color:var(--text-secondary);display:flex;align-items:center;gap:0.5rem;transition:all 0.15s;white-space:nowrap}
.tool-btn:hover{background:#f8fafc;border-color:#cbd5e1}
.breadcrumb-nav{padding:0.5rem 1.5rem;background:#fafbfc;border-top:1px solid #f1f5f9}
.breadcrumb{margin:0;padding:0;list-style:none;display:flex;align-items:center;gap:0.25rem;font-size:0.8125rem;flex-wrap:wrap}
.breadcrumb-item{display:flex;align-items:center;gap:0.25rem;color:var(--text-muted)}
.breadcrumb-item+.breadcrumb-item::before{content:"/";color:#cbd5e1;padding:0 0.25rem}
.breadcrumb-link{color:var(--accent);text-decoration:none;font-weight:500;display:flex;align-items:center;gap:0.375rem}
.breadcrumb-link:hover{color:var(--accent-hover);text-decoration:underline}
.main-content{flex:1;overflow-y:auto;padding:1rem 1.5rem}
.main-content::-webkit-scrollbar{width:5px}
.main-content::-webkit-scrollbar-track{background:transparent}
.main-content::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:10px}
.file-item{display:flex;align-items:center;gap:0.875rem;padding:0.75rem 1rem;background:#fff;border:1px solid transparent;border-radius:var(--radius-md);transition:all 0.2s;margin-bottom:0.25rem}
.file-item:hover{background:#f8fafc;border-color:#e2e8f0;box-shadow:var(--shadow-sm)}
.file-check-wrapper{display:flex;align-items:center;flex-shrink:0}
.file-checkbox{width:16px;height:16px;cursor:pointer;accent-color:var(--accent)}
.file-icon-wrapper{width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);font-size:1.35rem;flex-shrink:0}
.file-info{flex:1;min-width:0;cursor:pointer}
.file-name{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem}
.file-link{color:var(--text-primary);font-weight:500;font-size:0.875rem;word-break:break-word}
.file-link:hover{color:var(--accent)}
.file-tag{display:inline-flex;padding:0.125rem 0.5rem;background:#eff6ff;color:var(--accent);border-radius:100px;font-size:0.6875rem;font-weight:600;text-transform:uppercase}
.file-meta{display:flex;align-items:center;gap:1rem;font-size:0.75rem;color:var(--text-muted)}
.file-meta span{display:flex;align-items:center;gap:0.25rem}
.file-actions{display:flex;align-items:center;gap:0.25rem;opacity:0;transition:opacity 0.15s}
.file-item:hover .file-actions{opacity:1}
.icon-btn{width:30px;height:30px;border:none;background:transparent;border-radius:var(--radius-sm);cursor:pointer;color:var(--text-muted);font-size:0.875rem;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
.icon-btn:hover{background:#f1f5f9;color:var(--text-primary)}
.icon-btn.edit-btn:hover{background:#eff6ff;color:var(--accent)}
.icon-btn.rename-btn:hover{background:#fffbeb;color:#f59e0b}
.icon-btn.delete-btn:hover{background:#fef2f2;color:#ef4444}
.empty-state{text-align:center;padding:3rem 2rem}
.empty-icon-wrapper{width:80px;height:80px;background:#f1f5f9;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:2rem;color:#94a3b8}
.empty-state h3{font-size:1.125rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem}
.empty-state p{font-size:0.875rem;color:var(--text-muted);margin-bottom:1.5rem}
.empty-actions{display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap}
.empty-action-btn{padding:0.625rem 1.25rem;border:1px solid var(--border-color);background:#fff;border-radius:var(--radius-sm);cursor:pointer;font-size:0.8125rem;font-weight:500;font-family:var(--font-inter);color:var(--text-secondary);display:flex;align-items:center;gap:0.5rem;transition:all 0.15s}
.empty-action-btn:hover{background:#f8fafc;border-color:#cbd5e1}
.status-bar{display:flex;align-items:center;justify-content:space-between;padding:0.5rem 1.5rem;background:#fafbfc;border-top:1px solid #f1f5f9;font-size:0.75rem;color:var(--text-muted);flex-shrink:0}
.custom-modal-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:1000;align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn 0.2s ease}
.custom-modal-overlay.active{display:flex}
.custom-modal{background:#fff;border-radius:var(--radius-lg);box-shadow:var(--shadow-xl);width:90%;max-width:500px;max-height:90vh;overflow:hidden;animation:slideUp 0.25s ease}
.custom-modal.large{max-width:700px}
.custom-modal-header{padding:1.25rem 1.5rem;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:1rem;color:var(--text-primary)}
.custom-modal-close{width:32px;height:32px;border:none;background:transparent;border-radius:var(--radius-sm);cursor:pointer;color:var(--text-muted);font-size:1.25rem;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
.custom-modal-close:hover{background:#f1f5f9;color:var(--text-primary)}
.custom-modal-body{padding:1.5rem}
.custom-modal-body label{display:block;font-size:0.8125rem;font-weight:600;color:var(--text-secondary);margin-bottom:0.5rem}
.custom-input{width:100%;padding:0.625rem 0.875rem;border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.875rem;font-family:var(--font-inter);outline:none;transition:all 0.2s;margin-bottom:1rem}
.custom-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,0.1)}
.custom-textarea{width:100%;padding:0.625rem 0.875rem;border:1px solid var(--border-color);border-radius:var(--radius-sm);font-size:0.8125rem;font-family:'SF Mono','Fira Code','Consolas',monospace;outline:none;resize:vertical;min-height:250px;transition:all 0.2s;line-height:1.6}
.custom-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,0.1)}
.custom-modal-footer{padding:1rem 1.5rem;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:0.5rem}
.custom-btn{padding:0.5rem 1.25rem;border:1px solid var(--border-color);background:#fff;border-radius:var(--radius-sm);cursor:pointer;font-size:0.8125rem;font-weight:500;font-family:var(--font-inter);transition:all 0.15s}
.custom-btn:hover{background:#f8fafc}
.custom-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.custom-btn.primary:hover{background:var(--accent-hover)}
.custom-btn.danger{background:#ef4444;border-color:#ef4444;color:#fff}
.custom-btn.danger:hover{background:#dc2626}
.confirm-dialog .custom-modal{max-width:400px;text-align:center}
.confirm-icon{font-size:3rem;color:#f59e0b;margin-bottom:1rem}
.confirm-message{font-size:0.9375rem;color:var(--text-secondary);margin-bottom:1.5rem;line-height:1.5}
.toast-container{position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem}
.custom-toast{padding:0.75rem 1.25rem;border-radius:var(--radius-md);color:#fff;font-size:0.8125rem;font-weight:500;font-family:var(--font-inter);box-shadow:var(--shadow-md);animation:slideInRight 0.3s ease-out;display:flex;align-items:center;gap:0.5rem;min-width:280px}
.custom-toast.success{background:#059669}
.custom-toast.error{background:#dc2626}
.loading-overlay{display:none;position:fixed;inset:0;background:rgba(255,255,255,0.7);z-index:9998;justify-content:center;align-items:center;backdrop-filter:blur(2px)}
.loading-overlay.active{display:flex}
.spinner{width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite}
@keyframes slideInRight{from{opacity:0;transform:translateX(100%)}to{opacity:1;transform:translateX(0)}}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:768px){body{padding:0}.app-shell{border-radius:0;max-height:100vh}.nav-bar{flex-wrap:wrap}.search-wrapper{width:100%;order:1}.file-meta{flex-direction:column;gap:0.125rem;align-items:flex-start}.toolbar{overflow-x:auto}}
</style>
</head>
<body>
<div class="loading-overlay" id="loadingOverlay"><div class="spinner"></div></div>
<div class="toast-container" id="toastContainer"></div>

<div class="custom-modal-overlay confirm-dialog" id="confirmDialog">
  <div class="custom-modal">
    <div class="custom-modal-body" style="padding:2rem">
      <div class="confirm-icon"><i class="bi bi-exclamation-triangle-fill"></i></div>
      <div class="confirm-message" id="confirmMessage">Are you sure?</div>
      <div class="custom-modal-footer" style="border:none;justify-content:center">
        <button class="custom-btn" onclick="closeConfirm()">Cancel</button>
        <button class="custom-btn danger" id="confirmOkBtn">Delete</button>
      </div>
    </div>
  </div>
</div>

<div class="custom-modal-overlay" id="createFileModal">
  <div class="custom-modal large">
    <div class="custom-modal-header"><span><i class="bi bi-file-earmark-plus"></i> Create New File</span><button class="custom-modal-close" onclick="closeModal('createFileModal')">&times;</button></div>
    <div class="custom-modal-body">
      <label for="fileName">File Name</label>
      <input type="text" class="custom-input" id="fileName" placeholder="example.txt">
      <label for="fileContent">Content</label>
      <textarea class="custom-textarea" id="fileContent" placeholder="Enter file content..."></textarea>
    </div>
    <div class="custom-modal-footer">
      <button class="custom-btn" onclick="closeModal('createFileModal')">Cancel</button>
      <button class="custom-btn primary" onclick="createFile()">Create File</button>
    </div>
  </div>
</div>

<div class="custom-modal-overlay" id="createFolderModal">
  <div class="custom-modal">
    <div class="custom-modal-header"><span><i class="bi bi-folder-plus"></i> Create New Folder</span><button class="custom-modal-close" onclick="closeModal('createFolderModal')">&times;</button></div>
    <div class="custom-modal-body">
      <label for="folderName">Folder Name</label>
      <input type="text" class="custom-input" id="folderName" placeholder="New Folder">
    </div>
    <div class="custom-modal-footer">
      <button class="custom-btn" onclick="closeModal('createFolderModal')">Cancel</button>
      <button class="custom-btn primary" onclick="createFolder()">Create Folder</button>
    </div>
  </div>
</div>

<div class="custom-modal-overlay" id="editFileModal">
  <div class="custom-modal large">
    <div class="custom-modal-header"><span><i class="bi bi-pencil-square"></i> Edit File</span><button class="custom-modal-close" onclick="closeModal('editFileModal')">&times;</button></div>
    <div class="custom-modal-body">
      <input type="hidden" id="editFilePath">
      <textarea class="custom-textarea" id="editFileContent" style="min-height:350px"></textarea>
    </div>
    <div class="custom-modal-footer">
      <button class="custom-btn" onclick="closeModal('editFileModal')">Cancel</button>
      <button class="custom-btn primary" onclick="saveFile()">Save Changes</button>
    </div>
  </div>
</div>

<div class="custom-modal-overlay" id="renameModal">
  <div class="custom-modal">
    <div class="custom-modal-header"><span><i class="bi bi-pencil"></i> Rename</span><button class="custom-modal-close" onclick="closeModal('renameModal')">&times;</button></div>
    <div class="custom-modal-body">
      <input type="hidden" id="renameOldPath">
      <label for="renameNewName">New Name</label>
      <input type="text" class="custom-input" id="renameNewName" placeholder="Enter new name">
    </div>
    <div class="custom-modal-footer">
      <button class="custom-btn" onclick="closeModal('renameModal')">Cancel</button>
      <button class="custom-btn primary" onclick="renameItem()">Rename</button>
    </div>
  </div>
</div>

<div class="app-shell">
  <header class="app-header">
    <div class="header-top">
      <div class="app-brand"><div class="brand-icon"><i class="bi bi-folder-symlink"></i></div><span>Peek Explorer</span></div>
      <div><button class="header-btn" onclick="window.location.reload()" title="Refresh"><i class="bi bi-arrow-clockwise"></i></button></div>
    </div>
    <div class="nav-bar">
      <button class="nav-btn" onclick="history.back()" title="Back"><i class="bi bi-chevron-left"></i></button>
      <button class="nav-btn" onclick="history.forward()" title="Forward"><i class="bi bi-chevron-right"></i></button>
      <button class="nav-btn" onclick="goUp()" title="Up"><i class="bi bi-chevron-up"></i></button>
      <div class="address-bar"><i class="bi bi-folder2"></i><span>/${this.#escapeHtml(currentPath || "Home")}</span></div>
      <div class="search-wrapper"><i class="bi bi-search"></i><input type="text" class="search-input" id="searchInput" placeholder="Search..." oninput="filterFiles()"></div>
    </div>
    <div class="toolbar">
      <button class="tool-btn" onclick="showCreateFileModal()"><i class="bi bi-file-earmark-plus"></i> New File</button>
      <button class="tool-btn" onclick="showCreateFolderModal()"><i class="bi bi-folder-plus"></i> New Folder</button>
      <button class="tool-btn" onclick="deleteSelected()"><i class="bi bi-trash"></i> Delete</button>
      <button class="tool-btn" onclick="window.location.reload()"><i class="bi bi-arrow-repeat"></i> Refresh</button>
    </div>
    <nav class="breadcrumb-nav"><ol class="breadcrumb">${breadcrumbHtml}</ol></nav>
  </header>
  <main class="main-content" id="fileList">${itemsHtml}</main>
  <footer class="status-bar">
    <span id="statusMessage"><i class="bi bi-check-circle-fill" style="color:#10b981"></i> Ready</span>
    <span><i class="bi bi-collection"></i> ${itemsCount} item${itemsCount !== 1 ? "s" : ""}</span>
  </footer>
</div>

<script>
var currentPath = ${currentPathJson};
var allowedExts = ${allowedExtsJson};
var maxSize = ${maxSize};
var confirmCallback = null;

function showToast(message, type) {
  type = type || 'success';
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'custom-toast ' + type;
  toast.innerHTML = '<i class="bi bi-' + (type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill') + '"></i> ' + message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
}

function showLoading() { document.getElementById('loadingOverlay').classList.add('active'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('active'); }

function showConfirm(message) {
  return new Promise(function(resolve) {
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmDialog').classList.add('active');
    confirmCallback = resolve;
  });
}

function closeConfirm(result) {
  result = result || false;
  document.getElementById('confirmDialog').classList.remove('active');
  if (confirmCallback) { confirmCallback(result); confirmCallback = null; }
}

document.getElementById('confirmOkBtn').addEventListener('click', function() { closeConfirm(true); });

function showModal(id) {
  document.getElementById(id).classList.add('active');
  var input = document.getElementById(id).querySelector('input[type="text"]:not([id="editFilePath"]), textarea');
  if (input) setTimeout(function() { input.focus(); }, 100);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

document.querySelectorAll('.custom-modal-overlay').forEach(function(overlay) {
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      overlay.classList.remove('active');
      if (overlay.id === 'confirmDialog') closeConfirm(false);
    }
  });
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.custom-modal-overlay.active').forEach(function(overlay) {
      overlay.classList.remove('active');
      if (overlay.id === 'confirmDialog') closeConfirm(false);
    });
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
});

function goUp() {
  var parts = currentPath.split('/').filter(function(p) { return p; });
  parts.pop();
  if (parts.length === 0) {
    window.location.href = '/';
  } else {
    window.location.href = '/~/' + encodeURIComponent(parts.join('/'));
  }
}

function filterFiles() {
  var searchTerm = document.getElementById('searchInput').value.toLowerCase();
  document.querySelectorAll('.file-item').forEach(function(item) {
    var name = (item.querySelector('.file-link')?.textContent || '').toLowerCase();
    item.style.display = name.includes(searchTerm) ? '' : 'none';
  });
}

document.getElementById('fileList').addEventListener('click', function(e) {
  var btn = e.target.closest('button');
  if (btn) {
    e.stopPropagation();
    if (btn.classList.contains('edit-btn')) {
      editFile(btn.dataset.file);
    } else if (btn.classList.contains('delete-btn')) {
      deleteItem(btn.dataset.path, btn.dataset.type);
    } else if (btn.classList.contains('rename-btn')) {
      showRenameModal(btn.dataset.path);
    }
    return;
  }
  var fileInfo = e.target.closest('.file-info');
  if (fileInfo && fileInfo.dataset.href) {
    window.location.href = fileInfo.dataset.href;
  }
});

function showCreateFileModal() {
  document.getElementById('fileName').value = '';
  document.getElementById('fileContent').value = '';
  showModal('createFileModal');
}

function showCreateFolderModal() {
  document.getElementById('folderName').value = '';
  showModal('createFolderModal');
}

function showRenameModal(oldPath) {
  document.getElementById('renameOldPath').value = oldPath;
  document.getElementById('renameNewName').value = oldPath.split('/').pop();
  showModal('renameModal');
}

async function createFile() {
  var fileName = document.getElementById('fileName').value.trim();
  var content = document.getElementById('fileContent').value;
  if (!fileName) { showToast('Please enter a file name', 'error'); return; }
  var ext = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
  if (!ext || !allowedExts.includes(ext)) { showToast('Allowed: ' + allowedExts.join(', '), 'error'); return; }
  if (content.length > maxSize) { showToast('File too large. Max ' + (maxSize/1024/1024) + 'MB', 'error'); return; }
  showLoading();
  try {
    var res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath ? currentPath + '/' + fileName : fileName, content: content })
    });
    if (!res.ok) throw new Error(await res.text());
    closeModal('createFileModal');
    showToast('File created');
    setTimeout(function() { window.location.reload(); }, 400);
  } catch (err) { showToast(err.message, 'error'); }
  finally { hideLoading(); }
}

async function createFolder() {
  var folderName = document.getElementById('folderName').value.trim();
  if (!folderName) { showToast('Please enter a folder name', 'error'); return; }
  showLoading();
  try {
    var res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath ? currentPath + '/' + folderName : folderName })
    });
    if (!res.ok) throw new Error(await res.text());
    closeModal('createFolderModal');
    showToast('Folder created');
    setTimeout(function() { window.location.reload(); }, 400);
  } catch (err) { showToast(err.message, 'error'); }
  finally { hideLoading(); }
}

async function editFile(filePath) {
  showLoading();
  try {
    var res = await fetch('/api/files/' + encodeURIComponent(filePath));
    if (!res.ok) throw new Error('Failed to load file');
    var data = await res.json();
    document.getElementById('editFilePath').value = filePath;
    document.getElementById('editFileContent').value = data.content;
    showModal('editFileModal');
  } catch (err) { showToast(err.message, 'error'); }
  finally { hideLoading(); }
}

async function saveFile() {
  var filePath = document.getElementById('editFilePath').value;
  var content = document.getElementById('editFileContent').value;
  if (content.length > maxSize) { showToast('File too large', 'error'); return; }
  showLoading();
  try {
    var res = await fetch('/api/files/' + encodeURIComponent(filePath), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    if (!res.ok) throw new Error(await res.text());
    closeModal('editFileModal');
    showToast('File saved');
    setTimeout(function() { window.location.reload(); }, 400);
  } catch (err) { showToast(err.message, 'error'); }
  finally { hideLoading(); }
}

async function deleteItem(path, type) {
  var confirmed = await showConfirm('Delete this ' + type + '?\\n"' + path + '" will be permanently deleted.');
  if (!confirmed) return;
  showLoading();
  try {
    var res = await fetch('/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, type: type })
    });
    if (!res.ok) throw new Error(await res.text());
    showToast('Deleted');
    setTimeout(function() { window.location.reload(); }, 400);
  } catch (err) { showToast(err.message, 'error'); }
  finally { hideLoading(); }
}

async function deleteSelected() {
  var selected = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(function(cb) { return cb.value; });
  if (selected.length === 0) { showToast('No items selected', 'error'); return; }
  var confirmed = await showConfirm('Delete ' + selected.length + ' selected item(s)?');
  if (!confirmed) return;
  showLoading();
  try {
    var res = await fetch('/api/delete-multiple', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: selected })
    });
    if (!res.ok) throw new Error(await res.text());
    showToast('Deleted');
    setTimeout(function() { window.location.reload(); }, 400);
  } catch (err) { showToast(err.message, 'error'); }
  finally { hideLoading(); }
}

async function renameItem() {
  var oldPath = document.getElementById('renameOldPath').value;
  var newName = document.getElementById('renameNewName').value.trim();
  if (!newName) { showToast('Please enter a name', 'error'); return; }
  showLoading();
  try {
    var res = await fetch('/api/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: oldPath, newName: newName })
    });
    if (!res.ok) throw new Error(await res.text());
    closeModal('renameModal');
    showToast('Renamed');
    setTimeout(function() { window.location.reload(); }, 400);
  } catch (err) { showToast(err.message, 'error'); }
  finally { hideLoading(); }
}

window.showCreateFileModal = showCreateFileModal;
window.showCreateFolderModal = showCreateFolderModal;
window.showRenameModal = showRenameModal;
window.editFile = editFile;
window.deleteItem = deleteItem;
window.deleteSelected = deleteSelected;
window.goUp = goUp;
window.filterFiles = filterFiles;
window.createFile = createFile;
window.createFolder = createFolder;
window.saveFile = saveFile;
window.renameItem = renameItem;
window.closeModal = closeModal;
window.closeConfirm = closeConfirm;
</script>
</body>
</html>`;

    return html;
  }

  async #handleAPI(req, res, url) {
    if (url === "/api/files" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { path, content } = JSON.parse(body);
          const fullPath = join(this.#publicDir, path);
          if (!this.#isValidFilePath(fullPath)) throw new Error("Invalid path");
          if (!this.#isAllowedFileType(path))
            throw new Error("File type not allowed");
          if (content.length > this.#maxFileSize)
            throw new Error("File too large");
          const parentDir = dirname(fullPath);
          if (!existsSync(parentDir))
            await mkdir(parentDir, { recursive: true });
          await writeFile(fullPath, content, "utf8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return true;
    }

    if (url.startsWith("/api/files/") && req.method === "GET") {
      const filePath = decodeURIComponent(url.replace("/api/files/", ""));
      const fullPath = join(this.#publicDir, filePath);
      if (!this.#isValidFilePath(fullPath)) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: "Forbidden" }));
        return true;
      }
      try {
        const content = await readFile(fullPath, "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content }));
      } catch (error) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "File not found" }));
      }
      return true;
    }

    if (url.startsWith("/api/files/") && req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const filePath = decodeURIComponent(url.replace("/api/files/", ""));
          const { content } = JSON.parse(body);
          const fullPath = join(this.#publicDir, filePath);
          if (!this.#isValidFilePath(fullPath)) throw new Error("Invalid path");
          if (content.length > this.#maxFileSize)
            throw new Error("File too large");
          await writeFile(fullPath, content, "utf8");
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return true;
    }

    if (url === "/api/folders" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { path } = JSON.parse(body);
          const fullPath = join(this.#publicDir, path);
          if (!this.#isValidFilePath(fullPath)) throw new Error("Invalid path");
          await mkdir(fullPath, { recursive: true });
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return true;
    }

    if (url === "/api/delete" && req.method === "DELETE") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { path, type } = JSON.parse(body);
          const fullPath = join(this.#publicDir, path);
          if (!this.#isValidFilePath(fullPath)) throw new Error("Invalid path");
          const stats = await stat(fullPath);
          if (stats.isDirectory()) await rmdir(fullPath, { recursive: true });
          else await unlink(fullPath);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return true;
    }

    if (url === "/api/delete-multiple" && req.method === "DELETE") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { paths } = JSON.parse(body);
          for (const path of paths) {
            const fullPath = join(this.#publicDir, path);
            if (this.#isValidFilePath(fullPath) && existsSync(fullPath)) {
              const stats = await stat(fullPath);
              if (stats.isDirectory())
                await rmdir(fullPath, { recursive: true });
              else await unlink(fullPath);
            }
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return true;
    }

    if (url === "/api/rename" && req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { oldPath, newName } = JSON.parse(body);
          const oldFullPath = join(this.#publicDir, oldPath);
          const newFullPath = join(dirname(oldFullPath), newName);
          if (
            !this.#isValidFilePath(oldFullPath) ||
            !this.#isValidFilePath(newFullPath)
          )
            throw new Error("Invalid path");
          if (existsSync(newFullPath)) throw new Error("Already exists");
          await rename(oldFullPath, newFullPath);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return true;
    }

    return false;
  }

  async #handleRequest(req, res) {
    try {
      const rawUrl = req.url;
      const url = decodeURIComponent(rawUrl);

      // API
      if (url.startsWith("/api/")) {
        await this.#handleAPI(req, res, url);
        return;
      }

      // Home
      if (url === "/") {
        const page = await this.#generateUI("");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }

      // Directory browsing: /~/folder/subfolder
      if (url.startsWith("/~/")) {
        let dirPath = url.slice(3); // remove "/~/"
        if (dirPath.endsWith("/")) dirPath = dirPath.slice(0, -1);

        const fullPath = join(this.#publicDir, dirPath);
        if (existsSync(fullPath)) {
          const stats = await stat(fullPath);
          if (stats.isDirectory()) {
            const page = await this.#generateUI(dirPath);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(page);
            return;
          }
        }
        res.writeHead(404);
        res.end("404 Not Found");
        return;
      }

      // File serving: /f/folder/file.txt
      if (url.startsWith("/f/")) {
        const filePath = url.slice(3); // remove "/f/"
        const fullPath = join(this.#publicDir, filePath);
        if (!this.#isValidFilePath(fullPath)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        if (existsSync(fullPath)) {
          const stats = await stat(fullPath);
          if (stats.isFile()) {
            const content = await readFile(fullPath);
            const contentType = this.#getContentType(extname(fullPath));
            res.writeHead(200, { "Content-Type": contentType });
            res.end(content);
            return;
          }
        }
        res.writeHead(404);
        res.end("404 Not Found");
        return;
      }

      // Legacy redirect: /file/x -> /f/x
      if (url.startsWith("/file/")) {
        const filePath = url.slice(6);
        res.writeHead(301, { Location: "/f/" + filePath });
        res.end();
        return;
      }

      // Legacy redirect: /folder -> /~/folder
      if (!url.includes(".")) {
        let dirPath = url.startsWith("/") ? url.slice(1) : url;
        if (dirPath.endsWith("/")) dirPath = dirPath.slice(0, -1);
        res.writeHead(301, { Location: dirPath ? "/~/" + dirPath : "/" });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end("404 Not Found");
    } catch (error) {
      console.error(chalk.red("Error: " + error.message));
      res.writeHead(500);
      res.end("500 Internal Server Error");
    }
  }

  #createHttpServer() {
    return createServer((req, res) => this.#handleRequest(req, res));
  }

  #getLocalIP() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets))
      for (const net of nets[name])
        if (net.family === "IPv4" && !net.internal) return net.address;
    return "localhost";
  }

  async startServer() {
    const spinner = ora("Starting server...").start();
    if (this.#httpServer?.listening) {
      spinner.warn("Already running");
      return;
    }
    if (!existsSync(this.#publicDir)) {
      spinner.text = "Creating public directory...";
      await mkdir(this.#publicDir, { recursive: true });
      await writeFile(
        join(this.#publicDir, "welcome.txt"),
        "Welcome to Peek Explorer!",
      );
      await writeFile(
        join(this.#publicDir, "sample.html"),
        "<!DOCTYPE html><html><head><title>Sample</title></head><body><h1>Hello World!</h1></body></html>",
      );
    }
    this.#httpServer = this.#httpServer || this.#createHttpServer();
    await new Promise((resolve, reject) => {
      this.#httpServer.listen(this.#port, "0.0.0.0", () => {
        spinner.succeed("Server started");
        console.log(chalk.green("\n  Local: http://localhost:" + this.#port));
        console.log(
          chalk.cyan("  Explorer: http://localhost:" + this.#port + "\n"),
        );
        resolve();
      });
      this.#httpServer.on("error", reject);
    });
  }

  async stopServer() {
    if (!this.#httpServer?.listening) {
      console.log(chalk.yellow("Not running"));
      return;
    }
    await new Promise((resolve) =>
      this.#httpServer.close(() => {
        console.log(chalk.green("Stopped"));
        resolve();
      }),
    );
  }

  async restartServer() {
    if (!this.#httpServer?.listening) {
      console.log(chalk.yellow("Not running"));
      return;
    }
    await this.stopServer();
    this.#httpServer = null;
    await this.startServer();
  }

  async setPort() {
    const np = await this.#prompt("Port (1024-65535): ");
    const p = parseInt(np);
    if (!isNaN(p) && p >= 1024 && p <= 65535) {
      const wr = this.#httpServer?.listening;
      if (wr) await this.stopServer();
      this.#port = p;
      if (wr) await this.startServer();
      console.log(chalk.green("Port: " + p));
    } else console.log(chalk.red("Invalid"));
  }

  async setDirectory() {
    const nd = await this.#prompt("Directory: ");
    const rp = resolve(nd);
    if (existsSync(rp)) {
      const wr = this.#httpServer?.listening;
      if (wr) await this.stopServer();
      this.#publicDir = nd;
      if (wr) await this.startServer();
      console.log(chalk.green("Dir: " + rp));
    } else console.log(chalk.red("Not found"));
  }

  async copyUrlToClipboard() {
    await clipboardy.write("http://localhost:" + this.#port);
    console.log(chalk.green("Copied"));
  }

  showStatus() {
    console.log(
      chalk.cyan(
        "\n  Status: " +
          (this.#httpServer?.listening
            ? chalk.green("Running")
            : chalk.red("Stopped")),
      ),
    );
    console.log(
      "  Port: " + this.#port + "\n  Dir: " + resolve(this.#publicDir),
    );
  }

  showHelp() {
    console.log(
      chalk.cyan(
        "\n  start | stop | restart | status | port | dir | copy | help | exit\n",
      ),
    );
  }

  async runCLI() {
    console.log(chalk.cyan("\n  Peek Explorer\n"));
    let ui = await this.#prompt("> ");
    while (ui.trim().toLowerCase() !== "exit") {
      switch (ui.trim().toLowerCase()) {
        case "start":
          await this.startServer();
          break;
        case "stop":
          await this.stopServer();
          break;
        case "restart":
          await this.restartServer();
          break;
        case "status":
          this.showStatus();
          break;
        case "port":
          await this.setPort();
          break;
        case "dir":
          await this.setDirectory();
          break;
        case "copy":
          await this.copyUrlToClipboard();
          break;
        case "help":
          this.showHelp();
          break;
        case "clear":
          console.clear();
          break;
        default:
          if (ui.trim()) console.log(chalk.red("Unknown: " + ui));
      }
      ui = await this.#prompt("> ");
    }
    if (this.#httpServer?.listening) await this.stopServer();
    this.#readline.close();
  }
}

const program = new Command();
program
  .name("peek-explorer")
  .description("Modern file explorer server")
  .version("2.0.0");
program
  .option("-p, --port <number>", "Server port", "3000")
  .option("-d, --dir <path>", "Public directory", "./public");
program
  .command("start")
  .description("Start the server")
  .action(async () => {
    const o = program.opts();
    await new StaticFileServer({
      port: parseInt(o.port),
      directory: o.dir,
    }).startServer();
  });
program
  .command("cli")
  .description("Start interactive CLI mode")
  .action(async () => {
    const o = program.opts();
    await new StaticFileServer({
      port: parseInt(o.port),
      directory: o.dir,
    }).runCLI();
  });
program.parse();
if (!process.argv.slice(2).length) program.outputHelp();
