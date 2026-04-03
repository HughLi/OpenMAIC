'use client';

import { useState } from 'react';
import {
  Upload,
  Database,
  RefreshCw,
  ChevronDown,
  FolderOpen,
  ImageIcon,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useCategories } from '@/lib/hooks/use-categories';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { listStages, loadStageData } from '@/lib/utils/stage-storage';
import { db } from '@/lib/utils/database';
import type { SpeechAction } from '@/lib/types/action';
import { createLogger } from '@/lib/logger';

const log = createLogger('CourseImport');

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  ids: string[];
}

interface DiscoveredCourse {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  coverImage?: string;
  source: 'indexeddb' | 'localstorage';
  data?: unknown;
}

interface CourseImportMenuProps {
  onImportSuccess?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'dark';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function CourseImportMenu({
  onImportSuccess,
  variant = 'outline',
  size = 'default',
}: CourseImportMenuProps) {
  const [open, setOpen] = useState(false);
  const [importType, setImportType] = useState<'local' | 'indexeddb' | 'sync' | null>(null);
  const [jsonInput, setJsonInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  // New state for discovered courses selection
  const [discoveredCourses, setDiscoveredCourses] = useState<DiscoveredCourse[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());

  const { categories, isLoading: categoriesLoading } = useCategories();

  const handleOpen = (type: 'local' | 'indexeddb' | 'sync') => {
    setImportType(type);
    setOpen(true);
    setJsonInput('');
    setError('');
    setResult(null);
    setDiscoveredCourses([]);
    setSelectedCourseIds(new Set());

    if (type === 'indexeddb') {
      extractFromIndexedDB();
    } else if (type === 'local') {
      extractFromLocalStorage();
    }
  };

  // Extract from localStorage - discover courses for selection
  const extractFromLocalStorage = () => {
    const discovered: DiscoveredCourse[] = [];
    const patterns = ['classroom_', 'stage_', 'course_', 'classroom-data', 'my-courses'];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (patterns.some((p) => key.toLowerCase().includes(p.toLowerCase()))) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              parsed.forEach((item, idx) => {
                if (item && typeof item === 'object') {
                  discovered.push({
                    id: item.id || `${key}-${idx}`,
                    name: item.name || item.title || '未命名课程',
                    description: item.description,
                    sceneCount: item.scenes?.length || item.slides?.length || 0,
                    coverImage: item.coverImage,
                    source: 'localstorage',
                    data: item,
                  });
                }
              });
            } else if (parsed && typeof parsed === 'object') {
              discovered.push({
                id: parsed.id || key,
                name: parsed.name || parsed.title || '未命名课程',
                description: parsed.description,
                sceneCount: parsed.scenes?.length || parsed.slides?.length || 0,
                coverImage: parsed.coverImage,
                source: 'localstorage',
                data: parsed,
              });
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    if (discovered.length > 0) {
      setDiscoveredCourses(discovered);
      // Select all by default
      setSelectedCourseIds(new Set(discovered.map((c) => c.id)));
    } else {
      setError('未在浏览器存储中找到课程数据。请手动粘贴课程 JSON。');
    }
  };

  // Extract from IndexedDB using stage-storage utilities - discover courses for selection
  const extractFromIndexedDB = async () => {
    try {
      // Use stage-storage methods to get all stages
      const stages = await listStages();

      if (stages.length === 0) {
        setError('未在 IndexedDB 中找到课程数据。');
        return;
      }

      // Create discovered courses list with cover images
      const discovered: DiscoveredCourse[] = await Promise.all(
        stages.map(async (stage) => {
          // Try to load first scene to get cover image
          let coverImage: string | undefined;
          try {
            const stageData = await loadStageData(stage.id);
            if (stageData?.scenes?.length > 0) {
              const firstScene = stageData.scenes[0];
              // Try to extract image from scene content
              const content = firstScene.content as { canvas?: { elements?: Array<{ type: string; src?: string }> } } | undefined;
              if (content?.canvas?.elements) {
                const imageElement = content.canvas.elements.find(
                  (el) => el.type === 'image' && el.src
                );
                if (imageElement?.src) {
                  coverImage = imageElement.src;
                }
              }
            }
          } catch {
            // Ignore errors, just won't have cover image
          }

          return {
            id: stage.id,
            name: stage.name,
            description: stage.description,
            sceneCount: stage.sceneCount,
            coverImage,
            source: 'indexeddb' as const,
          };
        })
      );

      setDiscoveredCourses(discovered);
      // Select all by default
      setSelectedCourseIds(new Set(discovered.map((c) => c.id)));
    } catch {
      setError('无法访问 IndexedDB，请手动粘贴课程数据。');
    }
  };

  // Handle sync from server
  const handleSync = async () => {
    setIsLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
        : null;

      if (!token) {
        setError('请先登录');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/classroom/sync-files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (result.success) {
        setResult({
          imported: result.data?.synced || 0,
          skipped: 0,
          errors: [],
          ids: [],
        });
        onImportSuccess?.();
      } else {
        setError(result.error || '同步失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败');
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle course selection
  const toggleCourseSelection = (courseId: string) => {
    const newSelected = new Set(selectedCourseIds);
    if (newSelected.has(courseId)) {
      newSelected.delete(courseId);
    } else {
      newSelected.add(courseId);
    }
    setSelectedCourseIds(newSelected);
  };

  // Select/deselect all courses
  const toggleSelectAll = () => {
    if (selectedCourseIds.size === discoveredCourses.length) {
      setSelectedCourseIds(new Set());
    } else {
      setSelectedCourseIds(new Set(discoveredCourses.map((c) => c.id)));
    }
  };

  // Load full data for selected courses
  const loadSelectedCoursesData = async (): Promise<unknown[]> => {
    const selectedCourses = discoveredCourses.filter((c) => selectedCourseIds.has(c.id));
    const classrooms: unknown[] = [];

    for (const course of selectedCourses) {
      if (course.source === 'indexeddb') {
        const stageData = await loadStageData(course.id);
        if (stageData) {
          classrooms.push({
            id: course.id,
            name: course.name,
            description: course.description,
            stage: stageData.stage,
            scenes: stageData.scenes,
            chats: stageData.chats,
            currentSceneId: stageData.currentSceneId,
          });
        }
      } else if (course.source === 'localstorage' && course.data) {
        classrooms.push(course.data);
      }
    }

    return classrooms;
  };

  // Upload audio files from IndexedDB to server
  const uploadAudioFiles = async (classrooms: unknown[], importedIds: string[]) => {
    try {
      const token = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
        : null;

      if (!token) {
        log.warn('No token for audio upload');
        return;
      }

      // Build a map of original classroom IDs to imported IDs
      // The API returns ids in the order they were successfully imported
      const importedIdSet = new Set(importedIds);

      for (const classroom of classrooms) {
        const classroomData = classroom as {
          id: string;
          scenes?: Array<{ actions?: unknown[] }>;
        };

        // Only process if this classroom was successfully imported
        if (!importedIdSet.has(classroomData.id)) {
          log.info(`Skipping audio upload for non-imported course: ${classroomData.id}`);
          continue;
        }

        const importedId = classroomData.id;

        if (!classroomData.scenes) continue;

        // Extract audio IDs from speech actions
        const audioIds: string[] = [];
        for (const scene of classroomData.scenes) {
          for (const action of scene.actions || []) {
            const speechAction = action as SpeechAction;
            if (speechAction.type === 'speech' && speechAction.audioId) {
              audioIds.push(speechAction.audioId);
            }
          }
        }

        if (audioIds.length === 0) {
          log.info(`No audio files for course: ${classroomData.id}`);
          continue;
        }

        log.info(`Uploading ${audioIds.length} audio files for course: ${classroomData.id}`);

        // Upload each audio file
        for (const audioId of audioIds) {
          const audioRecord = await db.audioFiles.get(audioId);
          if (!audioRecord) {
            log.warn(`Audio file not found in IndexedDB: ${audioId}`);
            continue;
          }

          const formData = new FormData();
          formData.append('classroomId', importedId);
          formData.append('audioId', audioId);
          formData.append('audio', audioRecord.blob, `${audioId}.${audioRecord.format}`);

          const response = await fetch('/api/classroom/audio-upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
            body: formData,
          });

          if (!response.ok) {
            log.warn(`Failed to upload audio ${audioId}:`, await response.text());
          } else {
            log.info(`Audio uploaded: ${audioId}`);
          }
        }
      }
    } catch (err) {
      log.error('Audio upload failed:', err);
      // Don't fail the import if audio upload fails
    }
  };

  // Handle import
  const handleImport = async () => {
    if (importType === 'sync') {
      await handleSync();
      return;
    }

    // If we have discovered courses, use selected ones
    if (discoveredCourses.length > 0) {
      if (selectedCourseIds.size === 0) {
        setError('请至少选择一个课程');
        return;
      }

      setIsLoading(true);
      setError('');
      setResult(null);

      try {
        const classrooms = await loadSelectedCoursesData();

        if (classrooms.length === 0) {
          setError('无法加载选中的课程数据');
          setIsLoading(false);
          return;
        }

        // Add category if selected
        if (selectedCategory) {
          classrooms.forEach((c) => {
            (c as Record<string, unknown>).category = selectedCategory;
          });
        }

        const token = localStorage.getItem('openmaic_tokens')
          ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
          : null;

        if (!token) {
          setError('请先登录');
          setIsLoading(false);
          return;
        }

        const response = await fetch('/api/classroom/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(classrooms),
        });

        const result = await response.json();

        if (result.success) {
          setResult(result.data);

          // Upload audio files for imported courses
          if (result.data?.ids?.length > 0) {
            await uploadAudioFiles(classrooms, result.data.ids);
          }

          onImportSuccess?.();
        } else {
          setError(result.error || '导入失败');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '导入失败');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Fallback: use jsonInput for manual paste
    if (!jsonInput.trim()) {
      setError('请输入课程数据');
      return;
    }

    setIsLoading(true);
    setError('');
    setResult(null);

    try {
      let data: unknown;
      try {
        data = JSON.parse(jsonInput);
      } catch {
        setError('JSON 格式无效，请检查输入');
        setIsLoading(false);
        return;
      }

      const classrooms = Array.isArray(data) ? data : [data];

      // Add category if selected
      if (selectedCategory) {
        classrooms.forEach((c) => {
          (c as Record<string, unknown>).category = selectedCategory;
        });
      }

      const token = localStorage.getItem('openmaic_tokens')
        ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
        : null;

      if (!token) {
        setError('请先登录');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/classroom/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(classrooms),
      });

      const result = await response.json();

      if (result.success) {
        setResult(result.data);
        onImportSuccess?.();
      } else {
        setError(result.error || '导入失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setIsLoading(false);
    }
  };

  const getDialogTitle = () => {
    switch (importType) {
      case 'local':
        return '从浏览器导入课程';
      case 'indexeddb':
        return '从 IndexedDB 导入课程';
      case 'sync':
        return '同步服务器课程';
      default:
        return '导入课程';
    }
  };

  const getDialogDescription = () => {
    switch (importType) {
      case 'local':
        return '从浏览器本地存储导入课程数据';
      case 'indexeddb':
        return '从浏览器 IndexedDB 导入课程数据';
      case 'sync':
        return '从服务器同步课程文件';
      default:
        return '';
    }
  };

  const buttonClassName =
    variant === 'dark'
      ? 'gap-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 justify-start'
      : 'gap-2';

  const buttonVariant = variant === 'dark' ? 'outline' : variant;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={buttonVariant} size={size} className={buttonClassName}>
            <Upload className="w-4 h-4" />
            <span>导入/导出</span>
            <ChevronDown className="w-4 h-4 ml-auto" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleOpen('local')}>
            <Database className="w-4 h-4 mr-2" />
            从浏览器存储导入
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleOpen('indexeddb')}>
            <FolderOpen className="w-4 h-4 mr-2" />
            从 IndexedDB 导入
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleOpen('sync')}>
            <RefreshCw className="w-4 h-4 mr-2" />
            同步服务器课程
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px] p-0 flex flex-col max-h-[85vh]">
          <DialogHeader className="space-y-1 px-4 pt-4 pb-3 border-b flex-shrink-0">
            <DialogTitle className="text-base">{getDialogTitle()}</DialogTitle>
            <DialogDescription className="text-xs">{getDialogDescription()}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {importType !== 'sync' && (
              <>
                {/* Category Selection */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">课程分类（可选）</Label>
                  <Select
                    value={selectedCategory}
                    onValueChange={setSelectedCategory}
                    disabled={categoriesLoading}
                  >
                    <SelectTrigger className="w-full h-8 text-xs">
                      <SelectValue placeholder="选择分类" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.name} className="text-xs">
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Discovered Courses List */}
                {discoveredCourses.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium text-muted-foreground">
                        发现 {discoveredCourses.length} 个课程
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleSelectAll}
                        className="h-6 text-xs px-2 py-0"
                      >
                        {selectedCourseIds.size === discoveredCourses.length
                          ? '全不选'
                          : '全选'}
                      </Button>
                    </div>
                    <div className="border rounded-md min-w-0">
                      {discoveredCourses.map((course, index) => (
                        <div
                          key={course.id}
                          className={`flex items-center gap-2.5 p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors min-w-0 ${
                            index !== discoveredCourses.length - 1 ? 'border-b' : ''
                          }`}
                        >
                          <Checkbox
                            checked={selectedCourseIds.has(course.id)}
                            onCheckedChange={() => toggleCourseSelection(course.id)}
                            className="flex-shrink-0 h-4 w-4"
                          />
                          {/* Cover Image */}
                          <div className="flex-shrink-0 w-10 h-10 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                            {course.coverImage ? (
                              <img
                                src={course.coverImage}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  const parent = target.parentElement;
                                  if (parent) {
                                    parent.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-400"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
                                  }
                                }}
                              />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          {/* Course Info */}
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <p
                              className="font-medium text-sm truncate"
                              title={course.name}
                            >
                              {course.name}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <BookOpen className="w-3 h-3" />
                                {course.sceneCount} 场景
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        已选 {selectedCourseIds.size}/{discoveredCourses.length}
                      </span>
                      {selectedCourseIds.size > 0 && (
                        <span className="text-primary font-medium">
                          将导入 {selectedCourseIds.size} 个
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Manual JSON Input - show when no discovered courses or for fallback */}
                {discoveredCourses.length === 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">课程数据 (JSON)</Label>
                    <textarea
                      value={jsonInput}
                      onChange={(e) => setJsonInput(e.target.value)}
                      placeholder={`[{ "id": "...", "name": "...", "scenes": [...] }]`}
                      rows={5}
                      className="w-full px-2.5 py-2 border rounded-md font-mono text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                )}
              </>
            )}

            {error && (
              <Alert variant="destructive" className="text-xs py-2 px-3">
                <AlertCircle className="w-3.5 h-3.5" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {result && (
              <Alert className={`text-xs py-2 px-3 ${result.errors.length === 0 ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : ''}`}>
                <CheckCircle className={`w-3.5 h-3.5 ${result.errors.length === 0 ? 'text-green-600' : ''}`} />
                <AlertDescription>
                  {importType === 'sync' ? '同步' : '导入'}成功
                  {result.imported > 0 && ` ${result.imported} 个课程`}
                  {result.errors.length > 0 && (
                    <>, 失败 {result.errors.length} 个</>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {result?.errors && result.errors.length > 0 && (
              <div className="text-xs text-destructive bg-destructive/10 p-2.5 rounded max-h-[100px] overflow-y-auto">
                <p className="font-medium mb-1">错误详情：</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i} className="truncate" title={err}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

          </div>

          {/* Action Buttons - Outside scroll area */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t flex-shrink-0 bg-background">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-8 text-xs px-3"
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={isLoading || (importType !== 'sync' && discoveredCourses.length === 0 && !jsonInput.trim()) || (importType !== 'sync' && discoveredCourses.length > 0 && selectedCourseIds.size === 0)}
              className="h-8 text-xs px-4 bg-[#722ed1] hover:bg-[#722ed1]/90"
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {importType === 'sync' ? '同步' : `导入${selectedCourseIds.size > 0 ? ` ${selectedCourseIds.size}` : ''}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
