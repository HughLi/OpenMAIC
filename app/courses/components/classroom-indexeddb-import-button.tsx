'use client';

import React, { useState, useEffect } from 'react';
import { Upload, Database, AlertCircle, CheckCircle, Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { listStages, loadStageData } from '@/lib/utils/stage-storage';
import type { StageListItem } from '@/lib/utils/stage-storage';
import { useAuth } from '@/lib/auth/auth-context';
import { useRouter } from 'next/navigation';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  ids: string[];
}

interface ClassroomIndexedDBImportButtonProps {
  onImportSuccess?: () => void;
}

export function ClassroomIndexedDBImportButton({ onImportSuccess }: ClassroomIndexedDBImportButtonProps = {}) {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [localStages, setLocalStages] = useState<StageListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  // Scan IndexedDB when dialog opens
  useEffect(() => {
    if (open) {
      scanIndexedDB();
    }
  }, [open]);

  const scanIndexedDB = async () => {
    setIsScanning(true);
    setError('');
    try {
      const stages = await listStages();
      setLocalStages(stages);
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      setIsScanning(false);
    }
  };

  const handleImport = async () => {
    if (localStages.length === 0) {
      setError('没有可导入的课程');
      return;
    }

    setIsLoading(true);
    setError('');
    setResult(null);

    const results: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
      ids: [],
    };

    const token = localStorage.getItem('openmaic_tokens')
      ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
      : null;

    if (!token) {
      setError('请先登录');
      setIsLoading(false);
      return;
    }

    // Import each stage
    for (const stage of localStages) {
      try {
        // Load full stage data from IndexedDB
        const fullData = await loadStageData(stage.id);
        if (!fullData) {
          results.errors.push(`无法加载课程数据: ${stage.name}`);
          continue;
        }

        // Prepare import payload
        const importData = {
          id: stage.id,
          name: fullData.stage.name || stage.name,
          description: fullData.stage.description,
          category: 'other',
          language: fullData.stage.language || 'zh-CN',
          style: fullData.stage.style,
          createdAt: fullData.stage.createdAt || stage.createdAt,
          scenes: fullData.scenes.map((scene, index) => ({
            id: scene.id,
            stageId: stage.id, // Ensure stageId is set
            type: scene.type,
            title: scene.title,
            order: scene.order ?? index,
            content: scene.content,
            actions: scene.actions,
            whiteboards: scene.whiteboards,
            createdAt: scene.createdAt,
            updatedAt: scene.updatedAt,
          })),
        };

        // Send to server
        const response = await fetch('/api/classroom/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify([importData]),
        });

        const data = await response.json();

        if (data.success && data.data?.imported > 0) {
          results.imported++;
          results.ids.push(stage.id);
        } else {
          results.skipped++;
          if (data.data?.errors?.length > 0) {
            results.errors.push(...data.data.errors);
          } else if (data.error) {
            results.errors.push(`${stage.name}: ${data.error}`);
          } else {
            results.errors.push(`${stage.name}: 导入失败`);
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`导入 "${stage.name}" 失败: ${errorMsg}`);
      }
    }

    setResult(results);
    setIsLoading(false);

    // Refresh course list if import was successful
    if (results.imported > 0) {
      onImportSuccess?.();
      // Also refresh the page data
      router.refresh();
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Database className="w-4 h-4" />
        从浏览器导入
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>从浏览器存储导入课程</DialogTitle>
            <DialogDescription>
              自动扫描并导入 IndexedDB 中的本地课程到服务器
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {isScanning ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[#722ed1]" />
                <span className="ml-2 text-muted-foreground">扫描本地课程...</span>
              </div>
            ) : localStages.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">发现 {localStages.length} 个本地课程:</p>
                <div className="max-h-[200px] overflow-y-auto border rounded-lg">
                  {localStages.map((stage) => (
                    <div
                      key={stage.id}
                      className="flex items-center justify-between px-4 py-2 border-b last:border-b-0 hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{stage.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {stage.sceneCount} 场景 · {new Date(stage.updatedAt).toLocaleDateString()}更新
                        </p>
                      </div>
                      <code className="text-xs text-muted-foreground ml-2">{stage.id}</code>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Database className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">未在浏览器存储中找到课程</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  请确保在首页创建了课程
                </p>
              </div>
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
                  成功导入 {result.imported} 个课程
                  {result.skipped > 0 && <>, 跳过 {result.skipped} 个</>}
                  {result.errors.length > 0 && <>, 失败 {result.errors.length} 个</>}
                </AlertDescription>
              </Alert>
            )}

            {result?.errors && result.errors.length > 0 && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded max-h-[150px] overflow-y-auto">
                <p className="font-medium mb-2">错误详情：</p>
                <ul className="list-disc list-inside space-y-1">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
            {localStages.length > 0 && (
              <Button
                onClick={handleImport}
                disabled={isLoading}
                className="bg-[#722ed1] hover:bg-[#722ed1]/90"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    导入中...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    导入全部 ({localStages.length})
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
