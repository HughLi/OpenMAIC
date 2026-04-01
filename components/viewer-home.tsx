'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { BookOpen, Clock, ChevronRight, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { toast } from 'sonner';

interface ClassroomItem {
  id: string;
  title: string;
  description: string | null;
  sceneCount: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export function ViewerHome() {
  const router = useRouter();
  const { t } = useI18n();
  const { user } = useAuth();
  const [classrooms, setClassrooms] = useState<ClassroomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchClassrooms();
  }, []);

  const fetchClassrooms = async () => {
    try {
      const response = await fetch('/api/classroom');
      if (!response.ok) throw new Error('Failed to fetch classrooms');
      const data = await response.json();
      if (data.success) {
        setClassrooms(data.data.classrooms || []);
      }
    } catch (error) {
      toast.error('获取课程列表失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredClassrooms = classrooms.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <div className="border-b bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">欢迎回来，{user?.displayName || user?.username}</h1>
              <p className="text-muted-foreground mt-1">
                您有 {classrooms.length} 个可观看的课程
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full text-sm">
                观看者
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="mt-6 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索课程..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {filteredClassrooms.length === 0 ? (
          <div className="text-center py-20">
            <BookOpen className="h-16 w-16 mx-auto text-muted-foreground/30" />
            <h3 className="mt-4 text-lg font-medium">暂无课程</h3>
            <p className="text-muted-foreground mt-2">
              {searchQuery ? '没有找到匹配的课程' : '您还没有可观看的课程'}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => router.push('/apply-generator')}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              申请成为生成者
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClassrooms.map((classroom) => (
              <motion.div
                key={classroom.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4 }}
                className="group cursor-pointer"
                onClick={() => router.push(`/classroom/${classroom.id}`)}
              >
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-border/50 overflow-hidden shadow-sm hover:shadow-lg transition-all">
                  {/* Thumbnail placeholder */}
                  <div className="aspect-video bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
                    <BookOpen className="h-12 w-12 text-violet-400/50" />
                  </div>

                  <div className="p-5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Clock className="h-3 w-3" />
                      {formatDate(classroom.updatedAt)}
                      <span className="mx-1">·</span>
                      {classroom.sceneCount} 页
                    </div>

                    <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                      {classroom.title}
                    </h3>

                    {classroom.description && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {classroom.description}
                      </p>
                    )}

                    <div className="mt-4 flex items-center text-primary text-sm font-medium">
                      进入课程
                      <ChevronRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
