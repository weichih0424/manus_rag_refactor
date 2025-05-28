from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework import permissions
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView

from .views import (
    FileViewSet, 
    QueryView, 
    SettingAPIView, 
    TagViewSet,
    ChatMessageViewSet,
    ConversationViewSet,
    knowledge_base_status,
    vectorstore_maintenance,
    cancel_processing,
    file_status
)

# Create a router and register our viewsets with it.
router = DefaultRouter()
router.register(r"file", FileViewSet, basename="file")
router.register(r"tag", TagViewSet, basename="tag")
router.register(r"chat_history", ChatMessageViewSet, basename="chatmessage") # For viewing chat history
router.register(r"conversations", ConversationViewSet, basename="conversation")

# The API URLs are now determined automatically by the router.
# Additionally, we include a path for the QueryView and SettingsView.
urlpatterns = [
    # 必須先定義特定URL，然後才是路由註冊
    # File processing control endpoints
    path("file/<str:file_id>/cancel_processing/", cancel_processing, name="cancel-processing"),
    path("file/<str:file_id>/check_status/", file_status, name="file-status"),
    path("file/<str:file_id>/status/", file_status, name="file-status-compat"),
    
    # 知識庫狀態端點
    path("knowledge_base/status/", knowledge_base_status, name="api-kb-status"),
    # 向量庫維護端點
    path("admin/vectorstore/maintenance/", vectorstore_maintenance, name="api-vs-maintenance"),
    
    # User specific query endpoint
    path("query/", QueryView.as_view(), name="api-query"),
    # Settings endpoint
    path("setting/", SettingAPIView.as_view(), name="api-setting"),
    
    # 清除聊天歷史的明確路徑
    path("chat_history/clear/", ChatMessageViewSet.as_view({'delete': 'clear'}), name="clear-chat-history"),

    # 最後包含路由註冊的URL
    path("", include(router.urls)),
    
    # drf-spectacular schema and documentation
    path("schema/", SpectacularAPIView.as_view(), name="schema"),                      # OpenAPI schema (JSON)
    # http://localhost:8000/api/schema/swagger-ui
    path(
        "schema/swagger-ui/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="schema-swagger-ui",
    ),  # Swagger UI
    path(
        "schema/redoc/",
        SpectacularRedocView.as_view(url_name="schema"),
        name="schema-redoc",
    ),  # Redoc UI
]
