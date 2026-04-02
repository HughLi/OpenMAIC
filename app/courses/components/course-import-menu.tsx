'use client';

import { useState } from 'react';
import {
  Upload,
  Database,
  RefreshCw,
  ChevronDown,
  FolderOpen,
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

      // Create discovered courses list (without full data to save memory)
      const discovered: DiscoveredCourse[] = stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        description: stage.description,
        sceneCount: stage.sceneCount,
        source: 'indexeddb' as const,
      }));

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
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{getDialogTitle()}</DialogTitle>
            <DialogDescription>{getDialogDescription()}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {importType !== 'sync' && (
              <>
                {/* Category Selection */}
                <div className="space-y-2">
                  <Label>课程分类（可选）</Label>
                  <Select
                    value={selectedCategory}
                    onValueChange={setSelectedCategory}
                    disabled={categoriesLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择分类" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Discovered Courses List */}
                {discoveredCourses.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>发现的课程（{discoveredCourses.length}个）</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleSelectAll}
                        className="h-8 text-xs"
                      >
                        {selectedCourseIds.size === discoveredCourses.length
                          ? '全不选'
                          : '全选'}
                      </Button>
                    </div>
                    <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                      {discoveredCourses.map((course) => (
                        <div
                          key={course.id}
                          className="flex items-start gap-3 p-3 border-b last:border-b-0 hover:bg-slate-50"
                        >
                          <Checkbox
                            checked={selectedCourseIds.has(course.id)}
                            onCheckedChange={() => toggleCourseSelection(course.id)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {course.name}
                            </div>
                            {course.description && (
                              <div className="text-xs text-muted-foreground truncate mt-0.5">
                                {course.description}
                              </div>
                            )}
                            <div className="text-xs text-muted-foreground mt-1">
                              {course.sceneCount} 个场景
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      已选择 {selectedCourseIds.size} / {discoveredCourses.length} 个课程
                    </div>
                  </div>
                )}

                {/* Manual JSON Input - show when no discovered courses or for fallback */}
                {discoveredCourses.length === 0 && (
                  <div className="space-y-2">
                    <Label>课程数据 (JSON)</Label>
                    <textarea
                      value={jsonInput}
                      onChange={(e) => setJsonInput(e.target.value)}
                      placeholder={`[
  {
    "id": "course-id-1",
    "name": "课程名称",
    "description": "课程描述",
    "scenes": [...]
  }
]`}
                      rows={10}
                      className="w-full px-3 py-2 border rounded-md font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                )}
              </>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {result && (
              <Alert className={result.errors.length === 0 ? 'bg-green-50 border-green-200' : ''}>
                <CheckCircle className={result.errors.length === 0 ? 'w-4 h-4 text-green-600' : 'w-4 h-4'} />
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
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">
                <p className="font-medium mb-2">错误详情：</p>
                <ul className="list-disc list-inside space-y-1">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button
                onClick={handleImport}
                disabled={isLoading || (importType !== 'sync' && discoveredCourses.length === 0 && !jsonInput.trim()) || (importType !== 'sync' && discoveredCourses.length > 0 && selectedCourseIds.size === 0)}
                className="bg-[#722ed1] hover:bg-[#722ed1]/90"
              >
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {importType === 'sync' ? '同步' : '导入'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
