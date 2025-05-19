"""
LLM Manager - LLM 初始化與管理
"""
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain.chains import RetrievalQA
from langchain.retrievers.document_compressors import LLMChainExtractor

from api.managers.prompt_templates import create_standard_prompt, create_cot_prompt

class LLMManager:
    """LLM管理器類，負責初始化和管理LLM及其相關組件"""
    
    def __init__(self, settings: dict, vector_manager: Optional[any] = None):
        """
        初始化LLM管理器
        
        Args:
            settings: 配置設置字典
            vector_manager: 向量管理器對象（用於檢索器初始化）
        """
        self.settings = settings
        self.vector_manager = vector_manager
        
        # 初始化LLM
        try:
            self.llm = ChatOpenAI(
                model_name=self.settings['llm_model'],
                temperature=self.settings['temperature'],
                max_tokens=self.settings['max_tokens']
            )
            
            # 初始化提示模板
            self.standard_prompt = create_standard_prompt()
            self.cot_prompt = create_cot_prompt()
            
            # 如果有向量管理器，初始化QA鏈
            if self.vector_manager and self.vector_manager.vectorstore:
                retriever = self.vector_manager.vectorstore.as_retriever()
                
                # 初始化標準QA鏈
                self.qa_chain = RetrievalQA.from_chain_type(
                    llm=self.llm,
                    retriever=retriever,
                    chain_type="stuff",
                    chain_type_kwargs={"prompt": self.standard_prompt}
                )
                
                # 初始化思維鏈QA鏈
                self.cot_chain = RetrievalQA.from_chain_type(
                    llm=self.llm,
                    retriever=retriever,
                    chain_type="stuff",
                    chain_type_kwargs={"prompt": self.cot_prompt}
                )
                
                # 初始化重排序器
                if self.settings['use_reranking']:
                    self.reranker = LLMChainExtractor.from_llm(self.llm)
                else:
                    self.reranker = None
            else:
                self.qa_chain = None
                self.cot_chain = None
                self.reranker = None
                
        except Exception as e:
            print(f"初始化LLM時出錯: {str(e)}")
            self.llm = None
            self.qa_chain = None
            self.cot_chain = None
            self.reranker = None
    
    def update_llm_settings(self, new_settings: dict, vector_manager: Optional[any] = None) -> None:
        """
        更新LLM設置
        
        Args:
            new_settings: 新設置字典
            vector_manager: 向量管理器對象（用於更新檢索器）
        """
        self.settings.update(new_settings)
        try:
            self.llm = ChatOpenAI(
                model_name=self.settings['llm_model'],
                temperature=self.settings['temperature'],
                max_tokens=self.settings['max_tokens']
            )
            
            if vector_manager:
                self.vector_manager = vector_manager
            
            if self.vector_manager and self.vector_manager.vectorstore:
                retriever = self.vector_manager.vectorstore.as_retriever()
                
                # 更新標準QA鏈
                self.qa_chain = RetrievalQA.from_chain_type(
                    llm=self.llm,
                    retriever=retriever,
                    chain_type="stuff",
                    chain_type_kwargs={"prompt": self.standard_prompt}
                )
                
                # 更新思維鏈QA鏈
                self.cot_chain = RetrievalQA.from_chain_type(
                    llm=self.llm,
                    retriever=retriever,
                    chain_type="stuff",
                    chain_type_kwargs={"prompt": self.cot_prompt}
                )
                
                # 更新重排序器
                if self.settings['use_reranking']:
                    self.reranker = LLMChainExtractor.from_llm(self.llm)
                else:
                    self.reranker = None
            else:
                self.qa_chain = None
                self.cot_chain = None
                self.reranker = None
        except Exception as e:
            print(f"更新LLM設置時出錯: {str(e)}")
            self.llm = None
            self.qa_chain = None
            self.cot_chain = None
            self.reranker = None