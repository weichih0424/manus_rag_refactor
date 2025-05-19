import { Component, ElementRef, OnDestroy, OnInit, ViewChild, PLATFORM_ID, Inject, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { NgSelectModule } from '@ng-select/ng-select';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FileService } from '../shared/services/file.service';
import { TagService } from '../shared/services/tag.service';
import { 
  FileModel, 
  TagModel, 
  DuplicateFile, 
  UploadProgressItem 
} from '../shared/models/file.model';

declare var bootstrap: any;

@Component({
  selector: 'app-knowledge-base',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
  templateUrl: './knowledge-base.component.html',
  styleUrls: ['./knowledge-base.component.scss']
})
export class KnowledgeBaseComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('folderInput') folderInput!: ElementRef<HTMLInputElement>;

  // 列表資料
  uploadedFiles: FileModel[] = [];
  filteredFiles: FileModel[] = [];
  paginatedFiles: FileModel[] = [];
  duplicateFiles: DuplicateFile[] = [];
  filteredDuplicates: DuplicateFile[] = [];
  tags: TagModel[] = [];
  uploadProgressItems: UploadProgressItem[] = [];

  // 上傳控制
  uploadQueue: File[] = [];
  currentUploads = new Map<string, { xhr?: XMLHttpRequest, fileId?: string, isCancelled?: boolean }>();
  pendingFilesToUpload: File[] = [];
  pendingDuplicateFiles = new Map<string, { file: File | null, fileId: string }>();
  isDragOver = false;
  uploadProgressVisible = false;
  folderInputAccept = '.pdf,.txt,.docx,.csv,.html';
  selectedFileType = 'all';

  // 篩選與排序
  searchQuery = '';
  typeFilter = '';
  statusFilter = '';
  sortColumn = 'upload_time';
  sortDirection: 'asc' | 'desc' = 'desc';

  // 分頁
  currentPage = 1;
  itemsPerPage = 10;
  totalPages = 1;
  startPage = 1;
  endPage = 1;
  pageRange: number[] = [1];

  // 標籤選擇
  selectedTags: string[] = [];
  selectedFileIds = new Set<string>();

  // 重複文件模態框
  detailsVisible = false;
  duplicateSearchQuery = '';
  duplicateFileModal: any;
  duplicateActionResolver?: (value: string) => void;

  // 新增搜尋相關屬性
  searchTimeout: any;
  filterTimeout: any;
  duplicateSearchTimeout: any;
  
  // 統計資訊
  filesCount = 0;
  chunksCount = 0;
  
  // 輪詢間隔
  statusCheckIntervals = new Map<string, any>();
  
  // 組件銷毀管理
  private destroy$ = new Subject<void>();
  
  // 檢查是否全選或部分選中
  get isAllSelected(): boolean {
    return this.filteredFiles.length > 0 && 
           this.filteredFiles.every(file => this.selectedFileIds.has(file.id));
  }
  
  get isIndeterminate(): boolean {
    const selectedCount = this.filteredFiles.filter(file => this.selectedFileIds.has(file.id)).length;
    return selectedCount > 0 && selectedCount < this.filteredFiles.length;
  }
  
  constructor(
    private fileService: FileService,
    private tagService: TagService,
    private ngZone: NgZone,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    // 初始化基本數據，確保SSR有內容可渲染
    this.paginatedFiles = [];
    this.uploadedFiles = [];
    this.filteredFiles = [];
    this.tags = [];
    this.pageRange = [1];
    this.totalPages = 1;
    this.currentPage = 1;
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      // 初始化防抖屬性
      this.searchTimeout = null;
      this.filterTimeout = null;
      this.duplicateSearchTimeout = null;
      
      //console.log('正在初始化知識庫組件...');
      
      // 等待DOM加載完畢後再初始化
      this.ngZone.runOutsideAngular(() => {
        setTimeout(() => {
          this.ngZone.run(() => {
            //console.log('DOM已加載，開始初始化模態框和其他元素');
            this.initDuplicateFileModal();
            this.loadInitialData();
            this.setupAutoRefresh();
          });
        }, 100);
      });
    }
  }

  ngOnDestroy(): void {
    // 清理所有輪詢和訂閱
    this.destroy$.next();
    this.destroy$.complete();
    this.statusCheckIntervals.forEach(interval => clearInterval(interval));
  }

  // 初始化模態框
  private initDuplicateFileModal(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // 在 Zone.js 之外執行以避免水合問題
    this.ngZone.runOutsideAngular(() => {
      const modalElement = document.getElementById('duplicateFileModal');
      //console.log('模態框元素:', modalElement);
      
      if (modalElement) {
        try {
          if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            this.duplicateFileModal = new bootstrap.Modal(modalElement, {
              backdrop: 'static',
              keyboard: false
            });
            //console.log('模態框初始化完成');
            
            modalElement.addEventListener('hidden.bs.modal', () => {
              this.ngZone.run(() => {
                if (this.duplicateActionResolver) {
                  this.duplicateActionResolver('cancel');
                  this.duplicateActionResolver = undefined;
                }
              });
            });
          } else {
            //console.error('Bootstrap 未正確加載');
          }
        } catch (error) {
          //console.error('初始化模態框時出錯:', error);
        }
      } else {
        //console.error('找不到模態框元素: duplicateFileModal');
      }
    });
  }

  // 載入初始資料
  private loadInitialData(): void {
    // 只在瀏覽器環境中加載資料，避免SSR卡住
    if (isPlatformBrowser(this.platformId)) {
      this.loadTags();
      this.loadFiles();
      this.loadKnowledgeBaseStatus();
    }
  }

  // 設置自動刷新
  private setupAutoRefresh(): void {
    // 只在瀏覽器環境中設置定時刷新
    if (isPlatformBrowser(this.platformId)) {
      interval(10000)
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          if (this.currentUploads.size === 0 && this.statusCheckIntervals.size === 0) {
            this.loadFiles();
            this.loadKnowledgeBaseStatus();
          }
        });
    }
  }

  // 安全地顯示警告，確保在伺服器端不會出錯
  private safeAlert(message: string): void {
    if (isPlatformBrowser(this.platformId)) {
      alert(message);
    } else {
      //console.warn('Server-side alert:', message);
    }
  }

  // 安全地顯示確認對話框，在伺服器端總是返回false
  private safeConfirm(message: string): boolean {
    if (isPlatformBrowser(this.platformId)) {
      return confirm(message);
    } else {
      //console.warn('Server-side confirm:', message);
      return false;
    }
  }

  // 載入標籤列表
  loadTags(): void {
    this.tagService.getTags()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.tags = data;
        },
        error: (error) => {
          //console.error('載入標籤失敗:', error);
          this.safeAlert(`載入標籤失敗: ${error.message}`);
        }
      });
  }

  // 載入知識庫狀態
  loadKnowledgeBaseStatus(): void {
    this.fileService.getKnowledgeBaseStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.filesCount = data.files_count;
          this.chunksCount = data.chunks_count;
        },
        error: (error) => {
          //console.error('載入知識庫狀態出錯:', error);
        }
      });
  }

  // 載入文件列表
  loadFiles(): void {
    this.fileService.getFiles()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (files) => {
          this.uploadedFiles = files;
          this.applyFiltersAndSort();
        },
        error: (error) => {
          //console.error('載入文件列表出錯:', error);
        }
      });
  }

  // 應用篩選和排序
  applyFiltersAndSort(): void {
    // 使用 Array.filter 方法的優化版本
    const searchLower = this.searchQuery.toLowerCase();
    const typeLower = this.typeFilter.toLowerCase();
    const statusLower = this.statusFilter.toLowerCase();
    
    const hasSearchFilter = !!this.searchQuery;
    const hasTypeFilter = !!this.typeFilter;
    const hasStatusFilter = !!this.statusFilter;
    
    // 只有在需要篩選時才進行篩選操作
    if (!hasSearchFilter && !hasTypeFilter && !hasStatusFilter) {
      this.filteredFiles = [...this.uploadedFiles];
    } else {
      this.filteredFiles = this.uploadedFiles.filter(file => {
        // 先進行最快速的檢查
        if (hasTypeFilter && file.file_type.toLowerCase() !== typeLower) {
          return false;
        }
        
        if (hasStatusFilter && file.status.toLowerCase() !== statusLower) {
          return false;
        }
        
        if (hasSearchFilter) {
          return file.original_filename.toLowerCase().includes(searchLower) ||
            file.file_type.toLowerCase().includes(searchLower) ||
            file.status.toLowerCase().includes(searchLower);
        }
        
        return true;
      });
    }

    // 排序
    this.sortFilesInternal();

    // 分頁
    this.updatePagination();
  }

  // 更新分頁資訊
  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredFiles.length / this.itemsPerPage);
    
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    } else if (this.currentPage < 1 || this.totalPages === 0) {
      this.currentPage = 1;
    }

    const maxVisiblePages = 5;
    this.startPage = Math.max(1, this.currentPage - 2);
    this.endPage = Math.min(this.totalPages, this.startPage + maxVisiblePages - 1);
    
    if (this.endPage - this.startPage + 1 < maxVisiblePages) {
      this.startPage = Math.max(1, this.endPage - maxVisiblePages + 1);
    }

    this.pageRange = Array.from(
      { length: this.endPage - this.startPage + 1 }, 
      (_, i) => this.startPage + i
    );

    const start = (this.currentPage - 1) * this.itemsPerPage;
    const end = Math.min(start + this.itemsPerPage, this.filteredFiles.length);
    this.paginatedFiles = this.filteredFiles.slice(start, end);
  }

  // 切換頁面
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePagination();
      
      // 等待 DOM 更新後，滾動到分頁控制區域
      setTimeout(() => {
        // 找到分頁控制元素
        const paginationElement = document.querySelector('nav[aria-label="Files pagination"]');
        if (paginationElement) {
          // 滾動到分頁控制區域，保持其在視窗的下方但仍然可見
          paginationElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }, 0);
    }
  }

  // 排序文件列表
  sortFiles(column: string): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    
    this.sortFilesInternal();
    this.updatePagination();
  }

  // 內部排序邏輯
  private sortFilesInternal(): void {
    const statusOrder: { [key: string]: number } = {
      'uploading': 1,
      'processing': 2,
      'processed': 3,
      'error': 4,
      'cancelled': 5
    };

    this.filteredFiles.sort((a, b) => {
      let valueA: any, valueB: any;

      switch (this.sortColumn) {
        case 'original_filename':
          valueA = a.original_filename.toLowerCase();
          valueB = b.original_filename.toLowerCase();
          return this.sortDirection === 'asc' 
            ? valueA.localeCompare(valueB)
            : valueB.localeCompare(valueA);
        case 'file_type':
          valueA = a.file_type.toLowerCase();
          valueB = b.file_type.toLowerCase();
          return this.sortDirection === 'asc'
            ? valueA.localeCompare(valueB)
            : valueB.localeCompare(valueA);
        case 'file_size':
          valueA = a.file_size || 0;
          valueB = b.file_size || 0;
          return this.sortDirection === 'asc'
            ? valueA - valueB
            : valueB - valueA;
        case 'upload_time':
          valueA = new Date(a.upload_time);
          valueB = new Date(b.upload_time);
          return this.sortDirection === 'asc'
            ? valueA.getTime() - valueB.getTime()
            : valueB.getTime() - valueA.getTime();
        case 'status':
          valueA = statusOrder[a.status] || 6;
          valueB = statusOrder[b.status] || 6;
          return this.sortDirection === 'asc'
            ? valueA - valueB
            : valueB - valueA;
        case 'chunks_count':
          valueA = a.chunks_count || 0;
          valueB = b.chunks_count || 0;
          return this.sortDirection === 'asc'
            ? valueA - valueB
            : valueB - valueA;
        default:
          return 0;
      }
    });
  }

  // 搜尋變更事件
  onSearchChange(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
    
    this.searchTimeout = setTimeout(() => {
      this.currentPage = 1;
      this.applyFiltersAndSort();
    }, 300);
  }

  // 篩選變更事件
  onFilterChange(): void {
    if (this.filterTimeout) {
      clearTimeout(this.filterTimeout);
    }
    
    this.filterTimeout = setTimeout(() => {
      this.currentPage = 1;
      this.applyFiltersAndSort();
    }, 100);
  }

  // 當文件類型變更時
  onFileTypeChange(): void {
    if (this.selectedFileType === 'all') {
      this.folderInputAccept = '.pdf,.txt,.docx,.csv,.html';
    } else {
      this.folderInputAccept = `.${this.selectedFileType}`;
    }
  }

  // 格式化文件大小
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 獲取標籤顏色
  getTagColor(tagName: string | TagModel): string {
    if (typeof tagName !== 'string') {
      return tagName.color || 'secondary';
    }
    
    const tag = this.tags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
    return tag ? tag.color : 'secondary';
  }

  // 獲取標籤名稱 - 新增方法
  getTagName(tag: string | TagModel): string {
    if (typeof tag !== 'string') {
      return tag.name;
    }
    return tag;
  }

  // 獲取狀態 Badge 樣式
  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'uploading': return 'bg-info';
      case 'processing': return 'bg-warning';
      case 'processed': return 'bg-success';
      case 'error': return 'bg-danger';
      case 'cancelled': return 'bg-secondary';
      default: return 'bg-secondary';
    }
  }

  // 獲取狀態文字
  getStatusText(status: string): string {
    switch (status) {
      case 'uploading': return '上傳中';
      case 'processing': return '處理中';
      case 'processed': return '已處理';
      case 'error': return '錯誤';
      case 'cancelled': return '已取消';
      default: return '未知';
    }
  }

  // 拖放事件
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragOver = false;

    if (!event.dataTransfer) return;

    const items = event.dataTransfer.items;
    const droppedFiles: File[] = [];
    const promises: Promise<File[]>[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i].webkitGetAsEntry();
      if (item) {
        if (item.isFile) {
          if (event.dataTransfer.files[i]) {
            droppedFiles.push(event.dataTransfer.files[i]);
          }
        } else if (item.isDirectory) {
          promises.push(this.traverseDirectory(item));
        }
      }
    }

    try {
      const fileArrays = await Promise.all(promises);
      const allFiles = [...droppedFiles, ...fileArrays.flat()];
      const allowedFiles = this.filterFilesByType(allFiles, this.selectedFileType);
      
      const totalFiles = allFiles.length;
      const matchedFiles = allowedFiles.length;
      
      if (matchedFiles === 0) {
        this.safeAlert(`拖放的檔案或資料夾中共有 ${totalFiles} 個檔案，但沒有符合選擇格式（${this.selectedFileType.toUpperCase()}）的文件。`);
        return;
      }

      const userConfirmed = this.safeConfirm(
        `拖放的檔案或資料夾中共有 ${totalFiles} 個檔案，其中 ${matchedFiles} 個符合選擇格式（${this.selectedFileType.toUpperCase()}），是否開始上傳？`
      );
      
      if (userConfirmed) {
        await this.checkDuplicatesAndProceed(allowedFiles);
      }
    } catch (error) {
      //console.error('處理拖放文件時出錯:', error);
      this.safeAlert('處理拖放文件時出錯，請重試。');
    }
  }

  // 遍歷目錄，獲取所有文件
  private traverseDirectory(directory: any): Promise<File[]> {
    return new Promise((resolve) => {
      const files: File[] = [];
      const dirReader = directory.createReader();
      
      const readEntries = () => {
        dirReader.readEntries((entries: any[]) => {
          if (entries.length === 0) {
            resolve(files);
            return;
          }
          
          let processed = 0;
          
          entries.forEach(entry => {
            if (entry.isFile) {
              entry.file((file: File) => {
                files.push(file);
                processed++;
                if (processed === entries.length) {
                  readEntries();
                }
              }, () => {
                processed++;
                if (processed === entries.length) {
                  readEntries();
                }
              });
            } else if (entry.isDirectory) {
              this.traverseDirectory(entry).then(subFiles => {
                files.push(...subFiles);
                processed++;
                if (processed === entries.length) {
                  readEntries();
                }
              });
            } else {
              processed++;
              if (processed === entries.length) {
                readEntries();
              }
            }
          });
        });
      };
      
      readEntries();
    });
  }

  // 根據類型過濾文件
  private filterFilesByType(files: File[], selectedType: string): File[] {
    if (selectedType === 'all') {
      const allowedExtensions = ['pdf', 'txt', 'docx', 'csv', 'html'];
      return files.filter(file => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        return allowedExtensions.includes(ext);
      });
    } else {
      return files.filter(file => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        return ext === selectedType;
      });
    }
  }

  // 上傳文件事件處理
  uploadFile(): void {
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  // 上傳文件夾事件處理
  uploadFolder(): void {
    if (this.folderInput) {
      this.folderInput.nativeElement.click();
    }
  }

  // 文件選擇事件
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      this.checkDuplicatesAndProceed(files);
    }
    // 清空 value，這樣下次再選同一個檔案就能觸發 change 了
    input.value = '';
  }

  // 文件夾選擇事件
  onFolderSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      const selectedType = this.selectedFileType;
      const allowedFiles = this.filterFilesByType(files, selectedType);
      
      const totalFiles = files.length;
      const matchedFiles = allowedFiles.length;
      
      if (matchedFiles === 0) {
        this.safeAlert(`資料夾中共有 ${totalFiles} 個檔案，但沒有符合選擇格式（${selectedType.toUpperCase()}）的文件。`);
        return;
      }
      
      const userConfirmed = this.safeConfirm(
        `資料夾中共有 ${totalFiles} 個檔案，其中 ${matchedFiles} 個符合選擇格式（${selectedType.toUpperCase()}），是否開始上傳？`
      );
      
      if (userConfirmed) {
        this.checkDuplicatesAndProceed(allowedFiles);
      }
    }
    // 在這裡清空 value，保證下次選同一資料夾也會觸發 change
    input.value = '';
    // 或者直接操作 ViewChild：
    this.folderInput.nativeElement.value = '';
  }

  // 檢查重複文件並執行後續步驟
  async checkDuplicatesAndProceed(files: File[]): Promise<void> {
    // 檢查檔案大小
    const oversizedFiles = files.filter(file => file.size > 50 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      const oversizedFileNames = oversizedFiles.map(file => file.name).join(', ');
      this.safeAlert(`以下文件太大，最大文件大小為 50MB：${oversizedFileNames}`);
      files = files.filter(file => file.size <= 50 * 1024 * 1024);
    }

    if (files.length === 0) return;

    // 統一檔案名稱（移除路徑）
    const processedFiles = files.map(file => {
      const fileName = file.name.split('/').pop() || file.name; // 提取純檔案名稱
      return new File([file], fileName, { type: file.type, lastModified: file.lastModified });
    });

    // 儲存準備上傳的文件
    this.pendingFilesToUpload = processedFiles;

    // 顯示進度 UI
    this.uploadProgressVisible = true;
    processedFiles.forEach(file => {
      this.addUploadProgressUI(file);
      this.updateUploadStatus(file.name, '檢查中...');
    });

    // 檢查重複文件
    this.duplicateFiles = [];
    processedFiles.forEach(file => {
      const existingFile = this.uploadedFiles.find(f => f.original_filename === file.name);
      if (existingFile) {
        this.duplicateFiles.push({
          filename: file.name,
          fileId: existingFile.id
        });
      }
    });

    this.filteredDuplicates = [...this.duplicateFiles];

    //console.log('檢測到的重複檔案數量:', this.duplicateFiles.length, this.duplicateFiles);

    if (this.duplicateFiles.length > 0) {
      // 有重複文件，等待用戶選擇
      try {
        const action = await this.showDuplicateFileModal();

        if (action === 'cancel') {
          // 取消整個上傳操作
          this.pendingFilesToUpload.forEach(file => {
            this.removeUploadProgressUI(file.name, '上傳已取消');
          });
          this.pendingDuplicateFiles.clear();
          this.pendingFilesToUpload = [];
        } else if (action === 'skip') {
          // 跳過重複文件，只上傳非重複文件
          const nonDuplicateFiles = this.pendingFilesToUpload.filter(file => 
            !this.duplicateFiles.some(d => d.filename === file.name)
          );
          this.pendingFilesToUpload.forEach(file => {
            if (this.duplicateFiles.some(d => d.filename === file.name)) {
              this.removeUploadProgressUI(file.name, '已跳過上傳');
            }
          });
          this.pendingDuplicateFiles.clear();
          if (nonDuplicateFiles.length > 0) {
            this.queueFiles(nonDuplicateFiles);
          }
          this.pendingFilesToUpload = [];
        } else if (action === 'overwrite') {
          // 覆蓋重複文件
          for (const dup of this.duplicateFiles) {
            await this.deleteFile(dup.fileId, true);
            this.updateUploadStatus(dup.filename, '正在覆蓋...');
          }
          this.queueFiles(this.pendingFilesToUpload);
          this.pendingDuplicateFiles.clear();
          this.pendingFilesToUpload = [];
        }
      } catch (error) {
        //console.error('處理重複文件時出錯:', error);
        this.safeAlert('處理重複文件時出錯，請重試。');
      }
    } else {
      // 無重複文件，直接上傳
      this.queueFiles(processedFiles);
      this.pendingFilesToUpload = [];
    }
  }

  // 顯示重複文件模態框
  showDuplicateFileModal(): Promise<string> {
    //console.log('嘗試顯示重複檔案模態框');
    return new Promise((resolve) => {
      this.ngZone.run(() => {
        this.duplicateActionResolver = resolve;
        this.detailsVisible = false;
        this.duplicateSearchQuery = '';
        this.filteredDuplicates = [...this.duplicateFiles];
      });
      
      this.ngZone.runOutsideAngular(() => {
        setTimeout(() => {
          if (!this.duplicateFileModal) {
            //console.error('模態框未初始化!');
            
            // 在主線程中重新初始化模態框
            this.ngZone.run(() => this.initDuplicateFileModal());
            
            setTimeout(() => {
              try {
                if (this.duplicateFileModal) {
                  //console.log('延遲後顯示模態框');
                  this.forceShowModal();
                } else {
                  this.ngZone.run(() => resolve('cancel'));
                }
              } catch (error) {
                //console.error('延遲顯示模態框時出錯:', error);
                this.ngZone.run(() => resolve('cancel'));
              }
            }, 300);
          } else {
            try {
              //console.log('正在顯示模態框...');
              this.forceShowModal();
            } catch (error) {
              //console.error('顯示模態框時發生錯誤:', error);
              this.ngZone.run(() => resolve('cancel'));
            }
          }
        }, 0);
      });
    });
  }

  // 強制顯示模態框，確保視覺效果正常
  private forceShowModal(): void {
    try {
      // 使用原生DOM操作確保模態框顯示
      const modalEl = document.getElementById('duplicateFileModal');
      if (modalEl) {
        modalEl.classList.add('show');
        modalEl.style.display = 'block';
        document.body.classList.add('modal-open');
        
        // 添加背景遮罩
        let backdrop = document.querySelector('.modal-backdrop');
        if (!backdrop) {
          backdrop = document.createElement('div');
          backdrop.className = 'modal-backdrop fade show';
          document.body.appendChild(backdrop);
        }
        
        // 確保焦點不會導致 aria-hidden 問題
        modalEl.setAttribute('aria-modal', 'true');
        modalEl.setAttribute('role', 'dialog');
        modalEl.removeAttribute('aria-hidden');
      }
      
      // 嘗試使用 Bootstrap 的方法
      if (this.duplicateFileModal && typeof this.duplicateFileModal.show === 'function') {
        this.duplicateFileModal.show();
      }
    } catch (error) {
      //console.error('強制顯示模態框失敗:', error);
    }
  }

  // 處理重複文件模態框動作
  handleDuplicateAction(action: string): void {
    //console.log('處理模態框動作:', action);
    
    if (this.duplicateActionResolver) {
      // 在 Zone.js 之外執行 DOM 操作
      this.ngZone.runOutsideAngular(() => {
        // 先移除背景遮罩
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop && backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
        
        // 移除模態框相關的class
        const modalEl = document.getElementById('duplicateFileModal');
        if (modalEl) {
          modalEl.classList.remove('show');
          modalEl.style.display = 'none';
        }
        
        document.body.classList.remove('modal-open');
        
        // 調用 bootstrap 的隱藏方法
        try {
          if (this.duplicateFileModal && typeof this.duplicateFileModal.hide === 'function') {
            this.duplicateFileModal.hide();
          }
        } catch (e) {
          //console.error('隱藏模態框時出錯:', e);
        }
        
        // 返回到 Angular Zone 解析 Promise
        this.ngZone.run(() => {
          if (this.duplicateActionResolver) {
            this.duplicateActionResolver(action);
            this.duplicateActionResolver = undefined;
          }
        });
      });
    }
  }

  // 在模態框中切換詳情顯示
  toggleDetails(): void {
    this.detailsVisible = !this.detailsVisible;
    if (this.detailsVisible) {
      this.filterDuplicates();
    }
  }

  // 篩選重複文件
  filterDuplicates(): void {
    if (this.duplicateSearchTimeout) {
      clearTimeout(this.duplicateSearchTimeout);
    }
    
    this.duplicateSearchTimeout = setTimeout(() => {
      const query = this.duplicateSearchQuery.toLowerCase();
      this.filteredDuplicates = query
        ? this.duplicateFiles.filter(dup => dup.filename.toLowerCase().includes(query))
        : [...this.duplicateFiles];
    }, 200);
  }

  // 將文件加入上傳隊列
  queueFiles(files: File[]): void {
    files.forEach(file => {
      this.uploadQueue.push(file);
      this.updateUploadStatus(file.name, '等待上傳...');
    });
    this.processUploadQueue();
  }

  // 處理上傳隊列
  processUploadQueue(): void {
    const maxConcurrentUploads = 3;
    while (this.uploadQueue.length > 0 && this.currentUploads.size < maxConcurrentUploads) {
      const file = this.uploadQueue.shift();
      if (file) {
        this.uploadSingleFile(file);
      }
    }
  }

  // 上傳單個文件
  uploadSingleFile(file: File): void {
    this.updateUploadStatus(file.name, '上傳中...');
    this.updateUploadProgress(file.name, 0);

    // 更新進度項中的狀態
    const progressItemIndex = this.uploadProgressItems.findIndex(item => item.fileName === file.name);
    if (progressItemIndex === -1) {
      // 如果找不到進度項，先添加一個
      this.addUploadProgressUI(file);
    }

    // 添加到當前上傳清單
    const upload = { xhr: undefined as any, fileId: undefined as string | undefined, isCancelled: false };
    this.currentUploads.set(file.name, upload);
    
    // 在開始上傳前就將文件添加到表格中，標記為上傳中狀態
    const tempFile: FileModel = {
      id: 'temp_' + Date.now().toString(), // 臨時ID，待上傳完成後會更新
      original_filename: file.name,
      file_type: file.name.split('.').pop() || '',
      file_size: file.size,
      upload_time: new Date().toISOString(),
      status: 'uploading',
      tags: [],
      chunks_count: 0
    };
    this.uploadedFiles.unshift(tempFile);
    this.applyFiltersAndSort();

    // 使用修改後的 uploadFile 方法，獲取帶有 xhr 屬性的 Promise
    const uploadPromise = this.fileService.uploadFile(file, (percent) => {
      if (!upload.isCancelled) {
        this.updateUploadProgress(file.name, percent);
        this.updateUploadStatus(file.name, `上傳中... ${percent}%`);
      }
    });
    
    // 保存 XHR 對象
    upload.xhr = uploadPromise.xhr;
    
    // 同時保存到進度項中
    const itemIndex = this.uploadProgressItems.findIndex(item => item.fileName === file.name);
    if (itemIndex !== -1) {
      this.uploadProgressItems[itemIndex].xhr = uploadPromise.xhr;
    }
    
    // 處理 Promise
    uploadPromise.then(response => {
      if (upload.isCancelled) return;

      upload.fileId = response.id;
      this.updateUploadProgress(file.name, 100);
      this.updateUploadStatus(file.name, '處理中...');
      
      // 更新進度項中的檔案ID
      const itemIndex = this.uploadProgressItems.findIndex(item => item.fileName === file.name);
      if (itemIndex !== -1) {
        this.uploadProgressItems[itemIndex].fileId = response.id;
      }
      
      // 更新檔案資訊（替換臨時檔案）
      this.uploadedFiles = this.uploadedFiles.filter(f => f.id !== tempFile.id);
      this.uploadedFiles.unshift(response);
      this.applyFiltersAndSort();
      
      // 上傳完成後立即顯示為處理中
      const fileIndex = this.uploadedFiles.findIndex(f => f.id === response.id);
      if (fileIndex !== -1) {
        this.uploadedFiles[fileIndex].status = 'processing';
        this.applyFiltersAndSort();
      }
      
      // 檢查檔案處理狀態
      this.checkFileStatus(file.name, response.id);
      
      this.currentUploads.delete(file.name);
      this.processUploadQueue();
    }).catch(error => {
      if (upload.isCancelled) return;
      
      //console.error('上傳失敗:', error);
      this.updateUploadStatus(file.name, `上傳失敗: ${error}`);
      
      // 移除臨時檔案
      this.uploadedFiles = this.uploadedFiles.filter(f => f.id !== tempFile.id);
      this.applyFiltersAndSort();
      
      setTimeout(() => this.removeUploadProgressUI(file.name), 3000);
      
      this.currentUploads.delete(file.name);
      this.processUploadQueue();
    });
  }

  // 取消上傳
  cancelUpload(fileName: string): void {
    //console.log(`嘗試取消上傳: ${fileName}`);
    
    // 首先檢查進度項
    let foundItem = false;
    const progressItemIndex = this.uploadProgressItems.findIndex(item => item.fileName === fileName);
    
    if (progressItemIndex !== -1) {
      //console.log('在進度項中找到要取消的檔案');
      const progressItem = this.uploadProgressItems[progressItemIndex];
      progressItem.isCancelled = true;
      
      // 如果進度項中有 XHR，直接中止
      if (progressItem.xhr) {
        //console.log('使用進度項中的 XHR 中止請求');
        try {
          progressItem.xhr.abort();
          //console.log('成功中止 XHR 請求');
        } catch (e) {
          //console.error('中止 XHR 請求時出錯:', e);
        }
      }
      
      // 如果進度項中有檔案ID，立即取消處理並標記為已取消
      if (progressItem.fileId) {
        //console.log(`取消處理檔案ID: ${progressItem.fileId}`);
        
        // 直接標記為已取消，確保UI立即更新
        const fileIndex = this.uploadedFiles.findIndex(f => f.id === progressItem.fileId);
        if (fileIndex !== -1) {
          this.uploadedFiles[fileIndex].status = 'cancelled';
          this.applyFiltersAndSort();
        }
        
        // 清除狀態檢查間隔
        this.clearInterval(fileName);
        
        // 然後發送取消請求到伺服器
        this.cancelProcessing(progressItem.fileId);
      }
      
      foundItem = true;
    }
    
    // 同時檢查 currentUploads Map
    const upload = this.currentUploads.get(fileName);
    if (upload) {
      //console.log('在當前上傳列表中找到要取消的檔案');
      upload.isCancelled = true;
      
      // 如果 XHR 存在，則取消上傳請求
      if (upload.xhr) {
        //console.log(`XHR狀態: ${upload.xhr.readyState}`);
        try {
          upload.xhr.abort(); // 中止 XHR 請求
          //console.log('已中止 XHR 請求');
        } catch (e) {
          //console.error('中止 XHR 請求時出錯:', e);
        }
      }
      
      // 如果已有文件ID，直接標記為已取消，並發送取消請求
      if (upload.fileId) {
        //console.log(`取消處理文件ID: ${upload.fileId}`);
        
        // 直接標記為已取消，確保UI立即更新
        const fileIndex = this.uploadedFiles.findIndex(f => f.id === upload.fileId);
        if (fileIndex !== -1) {
          this.uploadedFiles[fileIndex].status = 'cancelled';
          this.applyFiltersAndSort();
        }
        
        // 清除狀態檢查間隔
        this.clearInterval(fileName);
        
        // 然後發送取消請求到伺服器
        this.cancelProcessing(upload.fileId);
      }
      
      this.currentUploads.delete(fileName);
      foundItem = true;
    }
    
    if (foundItem) {
      // 移除臨時檔案
      const beforeCount = this.uploadedFiles.length;
      this.uploadedFiles = this.uploadedFiles.filter(f => 
        !(f.original_filename === fileName && (f.id.startsWith('temp_') || f.status === 'uploading' || f.status === 'processing'))
      );
      //console.log(`已移除 ${beforeCount - this.uploadedFiles.length} 個臨時檔案`);
      this.applyFiltersAndSort();
      
      // 立即移除上傳進度UI
      this.removeUploadProgressUI(fileName, '上傳已取消');
      this.processUploadQueue();
    } else {
      //console.log(`沒有找到上傳項目: ${fileName}`);
      
      // 尋找完整路徑中是否含有這個檔案名
      const possibleMatches = Array.from(this.currentUploads.keys()).filter(key => 
        key.includes(fileName) || fileName.includes(key)
      );
      
      if (possibleMatches.length > 0) {
        //console.log(`找到可能的匹配: ${possibleMatches.join(', ')}`);
        // 嘗試取消第一個匹配項
        this.cancelUpload(possibleMatches[0]);
      }
    }
  }

  // 取消文件處理
  cancelProcessing(fileId: string): void {
    //console.log(`取消處理文件: ${fileId}`);
    
    // 先立即將檔案狀態標記為已取消
    const fileIndex = this.uploadedFiles.findIndex(f => f.id === fileId);
    if (fileIndex !== -1) {
      this.uploadedFiles[fileIndex].status = 'cancelled';
      this.applyFiltersAndSort();
    }
    
    // 找到對應的檔案名並清除狀態檢查間隔
    const fileName = this.findUploadItemByFileId(fileId);
    if (fileName) {
      this.clearInterval(fileName);
      this.removeUploadProgressUI(fileName, '處理已取消');
    }
    
    // 然後向後端發送取消請求
    this.fileService.cancelProcessing(fileId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          //console.log('成功發送取消處理請求:', response);
          // 確保後端取消處理後，重新讀取知識庫狀態更新界面
          this.loadKnowledgeBaseStatus();
        },
        error: (error) => {
          //console.error('取消處理失敗:', error);
          // 即使API請求失敗，也保持前端取消狀態
        }
      });
  }

  // 檢查文件處理狀態
  checkFileStatus(fileName: string, fileId: string, maxAttempts = 60): void {
    let attempts = 0;
    
    // 檢查檔案是否已經被取消
    const fileIndex = this.uploadedFiles.findIndex(f => f.id === fileId && f.status === 'cancelled');
    if (fileIndex !== -1) {
      //console.log(`檔案 ${fileId} 已被標記為取消，不啟動狀態檢查`);
      this.removeUploadProgressUI(fileName, '處理已取消');
      return;
    }
    
    // 立即同步一次知識庫狀態，以便快速獲取初始數據
    this.syncKnowledgeBase(fileId);

    const startTime = Date.now();
    // 使用更頻繁的檢查間隔，尤其是剛開始處理時
    const intervalId = setInterval(() => {
      // 再次檢查檔案是否已經被取消
      const cancelledFileIndex = this.uploadedFiles.findIndex(f => f.id === fileId && f.status === 'cancelled');
      if (cancelledFileIndex !== -1) {
        //console.log(`檔案 ${fileId} 已被標記為取消，停止狀態檢查`);
        clearInterval(intervalId);
        this.statusCheckIntervals.delete(fileName);
        this.removeUploadProgressUI(fileName, '處理已取消');
        return;
      }
      
      // 檢查次數上限
      if (attempts >= maxAttempts) {
        clearInterval(intervalId);
        this.statusCheckIntervals.delete(fileName);
        this.updateUploadStatus(fileName, '文件處理時間較長，但仍在進行。');
        return;
      }

      // 同步狀態並增加計數
      this.syncKnowledgeBase(fileId);
      attempts++;
      
      // 動態調整下次檢查時間
      if (attempts === 5) {
        clearInterval(intervalId);
        const newIntervalId = setInterval(() => {
          // 檢查檔案是否已經被取消
          const cancelledFileIndex = this.uploadedFiles.findIndex(f => f.id === fileId && f.status === 'cancelled');
          if (cancelledFileIndex !== -1) {
            //console.log(`檔案 ${fileId} 已被標記為取消，停止狀態檢查`);
            clearInterval(newIntervalId);
            this.statusCheckIntervals.delete(fileName);
            this.removeUploadProgressUI(fileName, '處理已取消');
            return;
          }
          
          if (attempts >= maxAttempts) {
            clearInterval(newIntervalId);
            this.statusCheckIntervals.delete(fileName);
            this.updateUploadStatus(fileName, '文件處理時間較長，但仍在進行。');
            return;
          }
          
          // 檢查處理狀態
          this.syncKnowledgeBase(fileId);
          attempts++;
        }, 5000);
        
        this.statusCheckIntervals.set(fileName, { 
          id: newIntervalId, 
          startTime: startTime 
        });
      }
    }, 2000); // 初始為每2秒檢查一次
    
    this.statusCheckIntervals.set(fileName, { id: intervalId, startTime: startTime });
  }

  // 同步知識庫狀態並檢查文件
  private syncKnowledgeBase(fileId: string): void {
    // 檢查是否已經被手動標記為取消
    const fileIndex = this.uploadedFiles.findIndex(f => f.id === fileId);
    if (fileIndex !== -1) {
      // 如果檔案已被標記為取消，直接跳過同步
      if (this.uploadedFiles[fileIndex].status === 'cancelled') {
        //console.log(`檔案 ${fileId} 已被標記為取消，跳過同步`);
        return;
      }
    } else {
      //console.log(`找不到檔案 ${fileId}，跳過同步`);
      return;
    }
    
    // 直接使用專門的檔案狀態查詢 API
    this.fileService.getFileStatus(fileId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (fileData) => {
          // 再次檢查當前檔案是否已被取消
          const currentFileIndex = this.uploadedFiles.findIndex(f => f.id === fileId);
          if (currentFileIndex !== -1) {
            const currentStatus = this.uploadedFiles[currentFileIndex].status;
            
            // 保護已取消的狀態不被覆蓋
            if (currentStatus === 'cancelled') {
              //console.log(`保持檔案 ${fileId} 的取消狀態不變`);
              return;
            }
            
            // 檢查狀態變化
            const oldStatus = this.uploadedFiles[currentFileIndex].status;
            
            // 更新文件資料，但保留相關文件處理狀態
            this.uploadedFiles[currentFileIndex] = fileData;
            
            // 如果狀態變化了，記錄到控制台
            if (oldStatus !== fileData.status) {
              //console.log(`檔案 ${fileId} 狀態更改為: ${fileData.status}`);
            }
            
            this.applyFiltersAndSort();
          }
          
          const fileName = this.findUploadItemByFileId(fileId);
          if (fileName) {
            // 如果被取消
            if (fileData.status === 'cancelled') {
              this.clearInterval(fileName);
              this.removeUploadProgressUI(fileName, '處理已取消');
              return;
            }

            // 更新進度UI
            if (this.statusCheckIntervals.has(fileName)) {
              const interval = this.statusCheckIntervals.get(fileName);
              const attempts = interval ? Math.floor((Date.now() - interval.startTime) / 5000) + 1 : 1;
              const progressText = `處理中... (${attempts}/60) ${fileData.processing_progress || ''}`;
              this.updateUploadStatus(fileName, progressText);
            }

            // 處理完成或失敗，跳出輪詢
            if (fileData.status === 'processed' || fileData.status === 'error') {
              this.clearInterval(fileName);
              if (fileData.status === 'processed') {
                this.removeUploadProgressUI(fileName, '處理完成!');
              } else {
                this.removeUploadProgressUI(fileName, '處理失敗: ' + (fileData.error_message || '未知錯誤'));
              }
              // 更新完成後重新加載知識庫狀態，更新統計資訊
              this.loadKnowledgeBaseStatus();
            }
          }
        },
        error: (err) => {
          //console.error('獲取檔案狀態出錯:', err);
        }
      });
  }
  
  // 根據文件ID查找上傳進度項的文件名
  private findUploadItemByFileId(fileId: string): string | null {
    for (const [fileName, upload] of this.currentUploads.entries()) {
      if (upload.fileId === fileId) {
        return fileName;
      }
    }
    
    // 檢查進度項中是否有匹配的文件ID
    const progressItem = this.uploadProgressItems.find(item => {
      const file = this.uploadedFiles.find(f => f.id === fileId);
      return file && item.fileName === file.original_filename;
    });
    
    return progressItem ? progressItem.fileName : null;
  }
  
  // 清除間隔並從列表中移除
  private clearInterval(fileName: string): void {
    if (this.statusCheckIntervals.has(fileName)) {
      clearInterval(this.statusCheckIntervals.get(fileName).id);
      this.statusCheckIntervals.delete(fileName);
    }
  }

  // 添加上傳進度 UI
  addUploadProgressUI(file: File): void {
    this.uploadProgressVisible = true;
    const existingIndex = this.uploadProgressItems.findIndex(item => item.fileName === file.name);
    
    if (existingIndex !== -1) {
      this.uploadProgressItems[existingIndex] = {
        fileName: file.name,
        progress: 0,
        status: '檢查中...',
        xhr: undefined,
        isCancelled: false
      };
    } else {
      this.uploadProgressItems.push({
        fileName: file.name,
        progress: 0,
        status: '檢查中...',
        xhr: undefined,
        isCancelled: false
      });
    }
  }

  // 更新上傳狀態
  updateUploadStatus(fileName: string, status: string): void {
    const itemIndex = this.uploadProgressItems.findIndex(item => item.fileName === fileName);
    if (itemIndex !== -1) {
      this.uploadProgressItems[itemIndex].status = status;
    }
  }

  // 更新上傳進度
  updateUploadProgress(fileName: string, percent: number): void {
    const itemIndex = this.uploadProgressItems.findIndex(item => item.fileName === fileName);
    if (itemIndex !== -1) {
      this.uploadProgressItems[itemIndex].progress = percent;
    }
  }

  // 移除上傳進度 UI
  removeUploadProgressUI(fileName: string, message?: string): void {
    if (message) {
      this.updateUploadStatus(fileName, message);
    }
    
    // 延遲3秒後移除進度項，讓用戶有時間看到最後狀態
    setTimeout(() => {
      this.uploadProgressItems = this.uploadProgressItems.filter(item => item.fileName !== fileName);
      
      // 如果沒有正在進行的上傳或進度項，隱藏整個上傳進度UI
      if (this.uploadProgressItems.length === 0 && this.currentUploads.size === 0) {
        this.uploadProgressVisible = false;
        this.uploadQueue = [];
        this.statusCheckIntervals.forEach(interval => clearInterval(interval.id));
        this.statusCheckIntervals.clear();
      }
    }, 3000);
  }

  // 刪除文件
  deleteFile(fileId: string, skipConfirm = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (skipConfirm || this.safeConfirm('確定要刪除此文件嗎？此操作無法撤銷。')) {
        this.fileService.deleteFile(fileId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (data) => {
              // 後端返回 204 No Content 時 data 可能為 null 或空
              // 無論回傳內容如何，均視為刪除成功
              this.selectedFileIds.delete(fileId);
              this.uploadedFiles = this.uploadedFiles.filter(f => f.id !== fileId);
              this.applyFiltersAndSort();
              this.loadKnowledgeBaseStatus();
              resolve();
            },
            error: (error) => {
              this.safeAlert('刪除文件時出錯: ' + error.message);
              reject(error);
            }
          });
      } else {
        resolve();
      }
    });
  }

  // 切換文件選擇
  toggleFileSelection(fileId: string): void {
    if (this.selectedFileIds.has(fileId)) {
      this.selectedFileIds.delete(fileId);
    } else {
      this.selectedFileIds.add(fileId);
    }
  }

  // 切換全選/取消全選
  toggleSelectAll(): void {
    if (this.isAllSelected) {
      // 取消全選
      this.filteredFiles.forEach(file => {
        this.selectedFileIds.delete(file.id);
      });
    } else {
      // 全選
      this.filteredFiles.forEach(file => {
        this.selectedFileIds.add(file.id);
      });
    }
  }

  // 應用標籤
  applyTags(): void {
    const selectedFiles = Array.from(this.selectedFileIds);
    
    if (selectedFiles.length === 0) {
      this.safeAlert('請選擇至少一個檔案');
      return;
    }
    
    if (this.selectedTags.length === 0) {
      this.safeAlert('請選擇至少一個標籤');
      return;
    }

    // 確保selectedTags中的每個標籤是適當處理過的
    const processedTags = this.selectedTags.map(tag => {
      if (typeof tag === 'string') {
        return tag;
      } else if (tag && typeof tag === 'object') {
        return (tag as any).name || tag;
      }
      return String(tag);
    });

    this.fileService.applyTags(selectedFiles, processedTags)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          if (data.success) {
            this.loadFiles();
            this.safeAlert('標籤應用成功');
          } else {
            throw new Error(data.error || '應用標籤失敗');
          }
        },
        error: (error) => {
          //console.error('應用標籤失敗:', error);
          this.safeAlert(`應用標籤失敗: ${error.message}`);
        }
      });
  }

  // 移除標籤
  removeTags(): void {
    const selectedFiles = Array.from(this.selectedFileIds);
    
    if (selectedFiles.length === 0) {
      this.safeAlert('請選擇至少一個檔案');
      return;
    }
    
    if (this.selectedTags.length === 0) {
      this.safeAlert('請選擇至少一個標籤');
      return;
    }

    // 確保selectedTags中的每個標籤是適當處理過的
    const processedTags = this.selectedTags.map(tag => {
      if (typeof tag === 'string') {
        return tag;
      } else if (tag && typeof tag === 'object') {
        return (tag as any).name || tag;
      }
      return String(tag);
    });

    this.fileService.removeTags(selectedFiles, processedTags)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          if (data.success) {
            this.loadFiles();
            this.safeAlert('標籤移除成功');
          } else {
            throw new Error(data.error || '移除標籤失敗');
          }
        },
        error: (error) => {
          //console.error('移除標籤失敗:', error);
          this.safeAlert(`移除標籤失敗: ${error.message}`);
        }
      });
  }
}
