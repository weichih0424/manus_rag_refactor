"""
Prompt Templates - 標準提示與 COT 提示模板
"""
from langchain.prompts import PromptTemplate

def create_standard_prompt() -> PromptTemplate:
    """
    創建標準提示模板
    
    Returns:
        提示模板
    """
    template = """
    系統：你是一個專業的問答助手，使用提供的上下文信息回答用戶問題。只使用上下文中的信息，如果上下文中沒有相關信息，請說明你不知道，而不要編造答案。

    上下文信息：
    {context}

    用戶問題：{question}

    回答要求：
    1. 直接回答問題，不要重複問題
    2. 如果上下文中有多個相關信息，請綜合它們
    3. 回答應該簡潔明了，但要包含所有相關細節
    4. 如果需要，可以使用項目符號或編號列表組織信息
    5. 引用上下文中的具體來源

    回答：
    """
    return PromptTemplate(template=template, input_variables=["context", "question"])

def create_cot_prompt() -> PromptTemplate:
    """
    創建思維鏈提示模板
    
    Returns:
        提示模板
    """
    template = """
    系統：你是一個專業的問答助手，使用提供的上下文信息回答用戶問題。只使用上下文中的信息，如果上下文中沒有相關信息，請說明你不知道，而不要編造答案。

    上下文信息：
    {context}

    用戶問題：{question}

    思考步驟：
    1. 分析問題，確定需要從上下文中找到哪些信息
    2. 從上下文中識別相關信息
    3. 組織這些信息，形成連貫的回答
    4. 檢查回答是否完整回應了問題

    請先逐步思考，然後給出最終回答。

    思考過程：
    """
    return PromptTemplate(template=template, input_variables=["context", "question"])