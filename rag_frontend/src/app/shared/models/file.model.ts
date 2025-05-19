export interface FileModel {
    id: string;
    original_filename: string;
    file_type: string;
    file_size: number;
    upload_time: string;
    status: 'uploading' | 'processing' | 'processed' | 'error' | 'cancelled';
    error_message?: string;
    chunks_count: number;
    processing_progress?: string;
    tags: string[];
}

export interface TagModel {
    id?: string;
    name: string;
    color: string;
}

export interface DuplicateFile {
    filename: string;
    fileId: string;
}

export interface UploadProgressItem {
    fileName: string;
    progress: number;
    status: string;
    fileId?: string;
    xhr?: XMLHttpRequest;
    isCancelled?: boolean;
}

export interface KnowledgeBaseStatus {
    files_count: number;
    chunks_count: number;
} 