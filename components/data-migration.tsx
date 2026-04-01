'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth/auth-context';
import { toast } from 'sonner';
import { Loader2, UploadCloud, CheckCircle, AlertCircle } from 'lucide-react';
import { db, StageRecord, SceneRecord, ChatSessionRecord } from '@/lib/utils/database';

interface MigrationStatus {
  stage: 'idle' | 'exporting' | 'uploading' | 'completed' | 'error';
  progress: number;
  message: string;
  totalStages: number;
  completedStages: number;
}

export function DataMigrationDialog() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<MigrationStatus>({
    stage: 'idle',
    progress: 0,
    message: '',
    totalStages: 0,
    completedStages: 0,
  });

  const migrateData = async () => {
    if (!user) {
      toast.error('请先登录');
      return;
    }

    try {
      setStatus({
        stage: 'exporting',
        progress: 0,
        message: '正在从浏览器导出数据...',
        totalStages: 0,
        completedStages: 0,
      });

      // Export all data from IndexedDB
      const stages = await db.stages.toArray();
      const scenes = await db.scenes.toArray();
      const chatSessions = await db.chatSessions.toArray();
      const audioFiles = await db.audioFiles.toArray();
      const mediaFiles = await db.mediaFiles.toArray();
      const generatedAgents = await db.generatedAgents.toArray();

      if (stages.length === 0) {
        toast.info('没有本地课程数据需要迁移');
        setStatus({
          stage: 'idle',
          progress: 0,
          message: '',
          totalStages: 0,
          completedStages: 0,
        });
        return;
      }

      setStatus({
        stage: 'uploading',
        progress: 10,
        message: `找到 ${stages.length} 个课程，开始上传...`,
        totalStages: stages.length,
        completedStages: 0,
      });

      // Group data by stage
      const stageDataMap = new Map<
        string,
        {
          stage: StageRecord;
          scenes: SceneRecord[];
          chats: ChatSessionRecord[];
        }
      >();

      for (const stage of stages) {
        stageDataMap.set(stage.id, {
          stage,
          scenes: [],
          chats: [],
        });
      }

      for (const scene of scenes) {
        const data = stageDataMap.get(scene.stageId);
        if (data) {
          data.scenes.push(scene);
        }
      }

      for (const chat of chatSessions) {
        const data = stageDataMap.get(chat.stageId);
        if (data) {
          data.chats.push(chat);
        }
      }

      let completed = 0;

      // Upload each stage
      for (const [stageId, data] of stageDataMap) {
        setStatus((prev) => ({
          ...prev,
          message: `正在迁移课程: ${data.stage.name}...`,
        }));

        // Get audio files for this stage
        const stageAudioFiles = audioFiles.filter((af) =>
          data.scenes.some(
            (s) => {
              // Check for audio in scene content (type assertion needed for legacy data)
              const contentAudio = (s.content as unknown as { audio?: { id: string } })?.audio;
              if (contentAudio?.id === af.id) return true;
              // Check for audio in actions
              return s.actions?.some((a) => {
                const actionWithContent = a as unknown as { content?: { audio?: { id: string } } };
                return actionWithContent.content?.audio?.id === af.id;
              });
            }
          )
        );

        // Get media files for this stage
        const stageMediaFiles = mediaFiles.filter((mf) => mf.stageId === stageId);

        // Get agents for this stage
        const stageAgents = generatedAgents.filter((ga) => ga.stageId === stageId);

        // Create FormData for multipart upload
        const formData = new FormData();
        formData.append('stageData', JSON.stringify(data.stage));
        formData.append('scenes', JSON.stringify(data.scenes));
        formData.append('chats', JSON.stringify(data.chats));
        formData.append('agents', JSON.stringify(stageAgents));

        // Add audio files
        for (const audio of stageAudioFiles) {
          formData.append(`audio_${audio.id}`, audio.blob, `${audio.id}.${audio.format}`);
        }

        // Add media files
        for (const media of stageMediaFiles) {
          formData.append(
            `media_${media.id}`,
            media.blob,
            `${media.id}.${media.mimeType.split('/')[1]}`
          );
        }

        // Upload to server
        const response = await fetch('/api/classroom/migrate', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Failed to migrate stage ${data.stage.name}`);
        }

        completed++;
        const progress = 10 + Math.floor((completed / stages.length) * 90);
        setStatus({
          stage: 'uploading',
          progress,
          message: `已完成 ${completed}/${stages.length} 个课程`,
          totalStages: stages.length,
          completedStages: completed,
        });
      }

      setStatus({
        stage: 'completed',
        progress: 100,
        message: `成功迁移 ${stages.length} 个课程到服务器`,
        totalStages: stages.length,
        completedStages: stages.length,
      });

      toast.success('数据迁移完成');
    } catch (error) {
      console.error('Migration error:', error);
      setStatus({
        stage: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : '迁移失败',
        totalStages: 0,
        completedStages: 0,
      });
      toast.error('数据迁移失败');
    }
  };

  const resetStatus = () => {
    setStatus({
      stage: 'idle',
      progress: 0,
      message: '',
      totalStages: 0,
      completedStages: 0,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) resetStatus();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UploadCloud className="mr-2 h-4 w-4" />
          迁移本地数据
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>迁移本地数据到服务器</DialogTitle>
          <DialogDescription>
            将浏览器中存储的课程数据迁移到服务器，以便在不同设备上访问。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {status.stage === 'idle' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                此操作将把您浏览器中存储的所有课程数据上传到服务器。迁移完成后，您可以在任何设备上登录访问这些课程。
              </AlertDescription>
            </Alert>
          )}

          {(status.stage === 'exporting' || status.stage === 'uploading') && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{status.message}</span>
              </div>
              <Progress value={status.progress} />
            </div>
          )}

          {status.stage === 'completed' && (
            <Alert className="border-green-500">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription>{status.message}</AlertDescription>
            </Alert>
          )}

          {status.stage === 'error' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{status.message}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {status.stage === 'completed' ? (
            <Button onClick={() => setOpen(false)}>完成</Button>
          ) : status.stage === 'error' ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button onClick={migrateData}>重试</Button>
            </>
          ) : status.stage === 'idle' ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button onClick={migrateData}>开始迁移</Button>
            </>
          ) : (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              处理中...
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
