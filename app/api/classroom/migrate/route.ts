import { NextRequest, NextResponse } from 'next/server';
import { classroomService } from '@/lib/server/classroom-service';
import { getUserFromRequest } from '@/lib/server/auth-helper';

/**
 * POST /api/classroom/migrate
 * Migrate classroom data from IndexedDB to server storage
 * Requires multipart/form-data with:
 * - stageData: JSON string of stage info
 * - scenes: JSON string of scenes array
 * - chats: JSON string of chat sessions
 * - agents: JSON string of generated agents
 * - audio_*: Audio blob files
 * - media_*: Media blob files
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await request.formData();

    // Parse JSON data
    const stageData = JSON.parse(formData.get('stageData') as string);
    const scenes = JSON.parse(formData.get('scenes') as string);
    const chats = JSON.parse(formData.get('chats') as string);
    const agents = JSON.parse(formData.get('agents') as string);

    // Extract files
    const files: Record<string, Blob> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('audio_') || key.startsWith('media_')) {
        files[key] = value as Blob;
      }
    }

    // Create classroom
    const classroom = await classroomService.createClassroom(user.id, {
      id: stageData.id,
      name: stageData.name,
      description: stageData.description,
      language: stageData.language,
      style: stageData.style,
    });

    // Save scenes with their content
    for (const scene of scenes) {
      const sceneFiles: Blob[] = [];

      // Find associated audio files for this scene
      const audioId = scene.content?.audio?.id;
      if (audioId && files[`audio_${audioId}`]) {
        sceneFiles.push(files[`audio_${audioId}`]);
      }

      // Check actions for audio
      if (scene.actions) {
        for (const action of scene.actions) {
          const actionAudioId = action.content?.audio?.id;
          if (actionAudioId && files[`audio_${actionAudioId}`]) {
            sceneFiles.push(files[`audio_${actionAudioId}`]);
          }
        }
      }

      await classroomService.saveScene(classroom.id, {
        id: scene.id,
        stageId: classroom.id,
        type: scene.type,
        title: scene.title,
        order: scene.order,
        content: scene.content,
        actions: scene.actions,
        whiteboards: scene.whiteboards,
        createdAt: scene.createdAt,
        updatedAt: scene.updatedAt,
      });

      // Save scene files
      for (const file of sceneFiles) {
        await classroomService.saveMedia(classroom.id, scene.id, file, {
          type: 'audio',
          filename: `${scene.id}_audio`,
        });
      }
    }

    // Save chat sessions as metadata
    if (chats.length > 0) {
      await classroomService.updateClassroom(classroom.id, user.id, {
        metadata: JSON.stringify({ chats, agents }),
      });
    }

    // Save media files
    for (const [key, blob] of Object.entries(files)) {
      if (key.startsWith('media_')) {
        const mediaId = key.replace('media_', '');
        await classroomService.saveMedia(classroom.id, mediaId, blob, {
          type: 'image',
          filename: mediaId,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: { classroomId: classroom.id },
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Migration failed',
      },
      { status: 500 }
    );
  }
}
