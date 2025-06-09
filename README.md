# Manus RAG 重構

一個檢索增強生成（RAG）網頁應用程式，後端使用 Django 構建乾淨的 Python 架構，前端使用 Angular 構建。專案分為以下兩個主要部分：

## 後端 (rag_backend/)
基於 Django 的後端，負責文件攝取、嵌入向量生成，以及向大語言模型（LLM）提供檢索增強的提示。

## 前端 (rag_frontend/)
一個 Angular 單頁應用程式，用於與知識庫對話、顯示來源，以及管理對話歷史。

## 功能特色
- **文件攝取與嵌入向量生成**：上傳並索引文件以供檢索。
- **向量庫檢索**：使用向量資料庫檢索相關文件。
- **思維鏈提示**：通過結構化推理增強大語言模型的回應。
- **帶來源顯示的聊天介面**：回應旁顯示相關來源。
- **對話管理**：建立、編輯和刪除對話。

## 技術架構
- **後端**：Python（Django、Django REST Framework、LangChain、ChromaDB 或同類方案）
- **前端**：Angular（TypeScript、HTML、SCSS）
- **樣式**：Bootstrap、自訂 SCSS
- **開發工具**：VSCode 設定檔位於 `.vscode/`

## 開始使用

### 先決條件
- Python 3.9 或以上
- Node.js 16 或以上及 npm
- （可選）Docker 與 Docker Compose

### 複製倉庫
```bash
git clone https://github.com/weichih0424/manus_rag_refactor.git
cd manus_rag_refactor
```

### 後端環境設定
```bash
cd rag_backend
# 建立虛擬環境
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
.\.venv\Scripts\activate   # Windows

# 安裝相依套件
pip install --upgrade pip
pip install -r requirements.txt

# 執行資料庫遷移
python manage.py makemigrations
python manage.py migrate
python manage.py init_settings

# 啟動 Django 開發伺服器
python manage.py runserver 0.0.0.0:8080
```

### 前端環境設定
```bash
cd ../rag_frontend
npm install
npm start
```
前端應用程式將在 `http://localhost:4200/` 執行，並透過 Proxy 將 API 請求轉發至後端的 8080 埠。

## 專案結構
```
manus_rag_refactor/
├── .gitignore
├── .vscode/                 # VSCode 編輯器設定
├── rag_backend/             # Django 後端
│   ├── manage.py            # Django 管理腳本
│   ├── rag_app/            # Django 應用程式（包含模型、視圖和 API）
│   ├── api/                # API 視圖與序列化器
│   ├── settings.py         # Django 設定
│   └── requirements.txt
└── rag_frontend/            # Angular 前端應用
    ├── src/
    │   ├── app/
    │   ├── assets/
    │   └── styles.scss
    ├── angular.json
    └── package.json
```

## 使用說明
1. 透過後端的 API 端點（例如 `/api/ingest/`）上傳或攝取要索引的文件。
2. 啟動前端應用程式，開始一個新的對話。
3. 提出問題，系統將自動檢索相關來源並顯示在回應旁。

## 貢獻指南
1. 在 GitHub 上 Fork 本倉庫。
2. 建立功能分支（`git checkout -b feature/你的功能名稱`）。
3. 提交修改（`git commit -m "新增：你的功能簡述"`）。
4. 推送並發送 Pull Request。

## 授權條款
本專案以 Eric_Chou 授權發佈。