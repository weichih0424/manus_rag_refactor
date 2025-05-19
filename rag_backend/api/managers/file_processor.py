"""
File Processor - 文件處理與文檔管理
包含文檔清洗、上下文生成和智能分割功能
"""
import os
import re
import sys
import sqlite3
from typing import List, Optional
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader, CSVLoader, UnstructuredHTMLLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document

# 自定義日誌函數，確保輸出後立即刷新
def log_message(message):
    """輸出日誌並立即刷新緩衝區"""
    print(message, flush=True)

class FileProcessor:
    """文件處理器類，負責處理和添加文件到RAG系統"""
    
    def __init__(self, settings: dict, embeddings: any, vector_manager: any, llm: any, chroma_db_dir: str, db_path: str):
        """
        初始化文件處理器
        
        Args:
            settings: 配置設置字典
            embeddings: 嵌入模型
            vector_manager: 向量管理器對象
            llm: LLM對象（用於生成上下文）
            chroma_db_dir: ChromaDB目錄
            db_path: SQLite數據庫路徑
        """
        self.settings = settings
        self.embeddings = embeddings
        self.vector_manager = vector_manager
        self.llm = llm
        self.chroma_db_dir = chroma_db_dir
        self.db_path = db_path  # 新增：數據庫路徑
        
        # 初始化文檔加載器
        self.loaders = {
            'pdf': PyPDFLoader,
            'txt': TextLoader,
            'docx': Docx2txtLoader,
            'csv': CSVLoader,
            'html': UnstructuredHTMLLoader
        }
        
        # 初始化文本分割器
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.settings['chunk_size'],
            chunk_overlap=self.settings['chunk_overlap'],
            separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
        )
    
    def _check_cancelled(self, file_id: str) -> bool:
        """
        檢查文件是否被取消
        
        Args:
            file_id: 文件ID
            
        Returns:
            是否被取消 (True 表示已取消)
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('SELECT status FROM files WHERE id = ?', (file_id,))
        result = cursor.fetchone()
        conn.close()
        if result and result[0] == 'cancelled':
            log_message(f"文件 {file_id} 已被取消")
            return True
        return False
    
    def _clean_documents(self, documents: List[Document]) -> List[Document]:
        """
        清洗文檔
        
        Args:
            documents: 文檔列表
            
        Returns:
            清洗後的文檔列表
        """
        cleaned_docs = []
        for doc in documents:
            text = doc.page_content.strip()
            text = ' '.join(text.split())
            if not text:
                continue
            cleaned_doc = Document(
                page_content=text,
                metadata=doc.metadata
            )
            cleaned_docs.append(cleaned_doc)
        return cleaned_docs
    
    def _generate_chunk_context(self, whole_document: str, chunk: str) -> str:
        """
        使用 LLM 為文本塊生成上下文描述
        
        Args:
            whole_document: 完整文檔內容
            chunk: 文本塊內容
            
        Returns:
            生成的上下文描述
        """
        if self.llm is None:
            return ""
        
        max_doc_length = 10000
        if len(whole_document) > max_doc_length:
            chunk_pos = whole_document.find(chunk)
            if chunk_pos != -1:
                context_window = 2000
                start_pos = max(0, chunk_pos - context_window)
                end_pos = min(len(whole_document), chunk_pos + len(chunk) + context_window)
                prefix = "..." if start_pos > 0 else ""
                suffix = " ..." if end_pos < len(whole_document) else ""
                whole_document = prefix + whole_document[start_pos:end_pos] + suffix
            else:
                whole_document = whole_document[:max_doc_length//2] + " ... " + whole_document[-max_doc_length//2:]
        
        prompt = f"""
        <document> 
        {whole_document} 
        </document> 
        Here is the chunk we want to situate within the whole document 
        <chunk> 
        {chunk} 
        </chunk> 
        Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else. The context should be in Traditional Chinese.
        """
        
        try:
            context = self.llm.predict(prompt)
            return context.strip()
        except Exception as e:
            log_message(f"生成上下文時出錯: {str(e)}")
            return ""
    
    def _improved_text_splitting(self, document: str) -> List[str]:
        """
        改進的文本分割策略，更好地保留文檔結構
        
        Args:
            document: 文檔內容
            
        Returns:
            分割後的文本塊列表
        """
        title_pattern = r'(^|\n)#+\s+.+?(?=\n#+\s+|\Z)'
        title_chunks = re.findall(title_pattern, document, re.DOTALL)
        if len(title_chunks) > 1:
            return title_chunks
        
        section_pattern = r'(^|\n)(?:\d+\.)+\s+.+?(?=\n(?:\d+\.)+\s+|\Z)'
        section_chunks = re.findall(section_pattern, document, re.DOTALL)
        if len(section_chunks) > 1:
            return section_chunks
        
        cn_section_pattern = r'(^|\n)第[一二三四五六七八九十百千]+[章節部分]\s*.+?(?=\n第[一二三四五六七八九十百千]+[章節部分]|\Z)'
        cn_section_chunks = re.findall(cn_section_pattern, document, re.DOTALL)
        if len(cn_section_chunks) > 1:
            return cn_section_chunks
        
        paragraphs = re.split(r'\n\s*\n', document)
        min_chunk_size = 100
        chunks = []
        current_chunk = ""
        
        for para in paragraphs:
            if not para.strip():
                continue
            if len(current_chunk) + len(para) < self.settings['chunk_size']:
                current_chunk += "\n\n" + para if current_chunk else para
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = para
        
        if current_chunk:
            chunks.append(current_chunk)
        
        if len(chunks) > 1 and all(len(chunk) >= min_chunk_size for chunk in chunks):
            return chunks
        
        return self.text_splitter.split_text(document)
    
    def _add_documents_to_vectorstore(self, documents: List[Document], file_id: str) -> None:
        """
        將文檔添加到向量存儲
        
        Args:
            documents: 文檔列表
            file_id: 文件ID，用於檢查取消狀態
        """
        # 最後檢查一次取消狀態
        if self._check_cancelled(file_id):
            log_message(f"文件 {file_id} 已被取消，不添加到向量庫")
            return
            
        # 為確保取消行為完全生效，先嘗試刪除文件相關的任何現有文檔
        try:
            # 獲取第一個文檔的文件路徑作為source
            if documents and len(documents) > 0 and 'source' in documents[0].metadata:
                source_path = documents[0].metadata['source']
                # 先清理向量庫中可能存在的相關文檔
                log_message(f"檢查並清理文件路徑 {source_path} 的現有文檔...")
                self.vector_manager.delete_documents_by_source(source_path)
            
            # 再次嘗試直接用file_id清理
            log_message(f"檢查並清理文件ID {file_id} 的現有文檔...")
            self.vector_manager.delete_file(file_id)
            
            # 最後添加新文檔到向量庫
            log_message(f"開始添加 {len(documents)} 個新文檔到向量庫...")
            self.vector_manager.add_documents(documents)
            log_message(f"已成功將 {len(documents)} 個文檔添加到向量存儲")
        except Exception as e:
            log_message(f"添加文檔到向量存儲時出錯: {str(e)}")
            import traceback
            traceback.print_exc()
    
    def process_file(self, file_id: str, file_path: str) -> List[Document]:
        """
        處理文件
        
        Args:
            file_id: 文件ID
            file_path: 文件路徑
            
        Returns:
            分割後的文檔列表
        """
        if not os.path.exists(file_path):
            log_message(f"文件不存在: {file_path}")
            return []
        
        file_extension = os.path.splitext(file_path)[1].lower().replace('.', '')
        
        try:
            if file_extension not in self.loaders:
                log_message(f"不支持的文件類型: {file_extension}")
                return []
            
            # 檢查是否取消
            if self._check_cancelled(file_id):
                return []
            
            loader = self.loaders[file_extension](file_path)
            documents = loader.load()
            
            # 檢查是否取消
            if self._check_cancelled(file_id):
                return []
            
            cleaned_documents = self._clean_documents(documents)
            
            if self.settings.get('use_intelligent_splitting', True):
                whole_document = "\n\n".join([doc.page_content for doc in cleaned_documents])
                
                # 檢查是否取消
                if self._check_cancelled(file_id):
                    return []
                
                chunks = self._improved_text_splitting(whole_document)
                
                page_map = {}
                current_pos = 0
                for doc in cleaned_documents:
                    doc_length = len(doc.page_content)
                    for i in range(current_pos, current_pos + doc_length):
                        page_map[i] = doc.metadata.get('page', 0)
                    current_pos += doc_length
                
                chunked_documents = []
                current_pos = 0
                for i, chunk in enumerate(chunks):
                    # 檢查是否取消
                    if self._check_cancelled(file_id):
                        return []
                    
                    chunk_length = len(chunk)
                    chunk_pages = set()
                    for j in range(current_pos, min(current_pos + chunk_length, len(whole_document))):
                        if j in page_map:
                            chunk_pages.add(page_map[j])
                    
                    page_number = min(chunk_pages) if chunk_pages else 0
                    
                    chunked_documents.append(Document(
                        page_content=chunk,
                        metadata={
                            'file_id': file_id,
                            'source': file_path,
                            'page': page_number,
                            'chunk_id': i
                        }
                    ))
                    current_pos += chunk_length
            else:
                # 檢查是否取消
                if self._check_cancelled(file_id):
                    return []
                
                chunked_documents = self.text_splitter.split_documents(cleaned_documents)
                for doc in chunked_documents:
                    doc.metadata['file_id'] = file_id
            
            # 檢查是否取消
            if self._check_cancelled(file_id):
                return []
            
            if self.settings.get('use_contextual_embeddings', True):
                whole_document = "\n\n".join([doc.page_content for doc in cleaned_documents])
                enhanced_documents = []
                for doc in chunked_documents:
                    # 檢查是否取消
                    if self._check_cancelled(file_id):
                        return []
                    
                    context = self._generate_chunk_context(whole_document, doc.page_content)
                    if context:
                        enhanced_content = f"{context}\n\n{doc.page_content}"
                        enhanced_doc = Document(
                            page_content=enhanced_content,
                            metadata=doc.metadata
                        )
                        enhanced_documents.append(enhanced_doc)
                    else:
                        enhanced_documents.append(doc)
                chunked_documents = enhanced_documents
            
            # 檢查是否取消
            if self._check_cancelled(file_id):
                return []
            
            self._add_documents_to_vectorstore(chunked_documents, file_id)
            log_message(f"文件 {file_id} 處理完成，共 {len(chunked_documents)} 個文檔塊")
            return chunked_documents
            
        except Exception as e:
            log_message(f"處理文件 {file_id} 時出錯: {str(e)}")
            return []
    
    def add_document(self, file_path: str, file_id: str, original_filename: str) -> List[Document]:
        """
        添加文檔到RAG系統
        
        Args:
            file_path: 文件路徑
            file_id: 文件ID
            original_filename: 原始文件名
            
        Returns:
            分割後的文檔列表
        """
        if not os.path.exists(file_path):
            log_message(f"文件不存在: {file_path}")
            return []
        
        file_ext = os.path.splitext(file_path)[1].lower().replace('.', '')
        if file_ext not in self.loaders:
            log_message(f"不支持的文件類型: {file_ext}")
            return []
        
        try:
            # 檢查是否取消
            if self._check_cancelled(file_id):
                return []
            
            loader = self.loaders[file_ext](file_path)
            documents = loader.load()
            whole_document = "\n\n".join([doc.page_content for doc in documents])
            chunked_documents = []
            
            if self.settings.get('use_intelligent_splitting', True):
                # 檢查是否取消
                if self._check_cancelled(file_id):
                    return []
                
                chunks = self._improved_text_splitting(whole_document)
                for i, chunk in enumerate(chunks):
                    # 檢查是否取消
                    if self._check_cancelled(file_id):
                        return []
                    
                    if self.settings.get('use_contextual_embeddings', True):
                        context = self._generate_chunk_context(whole_document, chunk)
                        enhanced_chunk = f"{context}\n\n{chunk}" if context else chunk
                    else:
                        enhanced_chunk = chunk
                    chunked_documents.append(Document(
                        page_content=enhanced_chunk,
                        metadata={
                            'file_id': file_id,
                            'source': file_path,
                            'page': 0,
                            'chunk_id': i
                        }
                    ))
            else:
                # 檢查是否取消
                if self._check_cancelled(file_id):
                    return []
                
                cleaned_documents = self._clean_documents(documents)
                chunked_documents = self.text_splitter.split_documents(cleaned_documents)
                for i, doc in enumerate(chunked_documents):
                    doc.metadata['file_id'] = file_id
                    if self.settings.get('use_contextual_embeddings', True):
                        # 檢查是否取消
                        if self._check_cancelled(file_id):
                            return []
                        
                        context = self._generate_chunk_context(whole_document, doc.page_content)
                        if context:
                            doc.page_content = f"{context}\n\n{doc.page_content}"
            
            # 檢查是否取消
            if self._check_cancelled(file_id):
                return []
            
            self._add_documents_to_vectorstore(chunked_documents, file_id)
            log_message(f"成功添加文件: {original_filename}, 共 {len(chunked_documents)} 個文本塊")
            return chunked_documents
        except Exception as e:
            log_message(f"添加文檔時出錯: {str(e)}")
            import traceback
            traceback.print_exc()
            return []
    
    def update_settings(self, new_settings: dict) -> None:
        """
        更新設置
        
        Args:
            new_settings: 新設置字典
        """
        self.settings.update(new_settings)
        if 'chunk_size' in new_settings or 'chunk_overlap' in new_settings:
            self.text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=self.settings['chunk_size'],
                chunk_overlap=self.settings['chunk_overlap'],
                separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
            )