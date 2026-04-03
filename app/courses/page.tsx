'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Search,
  Grid3X3,
  List,
  Star,
  Users,
  Menu,
  X,
  BookOpen,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useCourses, type Course, type CourseCategory } from '@/lib/hooks/use-courses';
import { useCategories } from '@/lib/hooks/use-categories';
import type { ViewMode, SortOption } from './types';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';


interface CourseCardProps {
  course: Course;
  viewMode: ViewMode;
}

export function CourseCard({ course, viewMode }: CourseCardProps) {
  const isGrid = viewMode === 'grid';
  const router = useRouter();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleClick = () => {
    router.push(`/classroom/${course.id}`);
  };

  const hasThumbnail = course.firstSlide && thumbWidth > 0;
  const hasCoverImage = course.coverImage && !course.coverImage.startsWith('/data/classrooms/covers/null');

  return (
    <div
      data-testid="course-card"
      onClick={handleClick}
      className={cn(
        'group bg-card rounded-xl border border-border overflow-hidden transition-all duration-200 hover:shadow-lg cursor-pointer',
        isGrid ? 'flex flex-col' : 'flex flex-row'
      )}
    >
      {/* Cover Image */}
      <div
        ref={thumbRef}
        className={cn(
          'relative overflow-hidden bg-slate-100 dark:bg-slate-800/80',
          isGrid ? 'w-full aspect-[16/10]' : 'w-36 h-24 shrink-0'
        )}
      >
        {hasThumbnail ? (
          <ThumbnailSlide
            slide={course.firstSlide!}
            size={thumbWidth}
            viewportSize={course.firstSlide!.viewportSize ?? 1000}
            viewportRatio={course.firstSlide!.viewportRatio ?? 0.5625}
          />
        ) : hasCoverImage ? (
          <Image
            src={course.coverImage}
            alt={course.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#722ed1]/20 to-purple-300/20">
            <BookOpen className="w-12 h-12 text-[#722ed1]/40" />
          </div>
        )}
        {/* Category Badge */}
        <Badge
          className="absolute top-2 left-2 bg-[#722ed1] text-white hover:bg-[#722ed1]/90"
        >
          {course.category}
        </Badge>
      </div>

      {/* Content */}
      <div className="flex-1 p-3 flex flex-col">
        <h3 className="font-medium text-sm mb-1 line-clamp-2 group-hover:text-[#722ed1] transition-colors leading-tight">
          {course.title}
        </h3>

        {/* Instructor */}
        <div className="flex items-center gap-1.5 mb-1.5">
          {course.instructor.avatar ? (
            <Image
              src={course.instructor.avatar}
              alt={course.instructor.name}
              width={20}
              height={20}
              className="rounded-full"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px]">
              {course.instructor.name.charAt(0)}
            </div>
          )}
          <span className="text-xs text-muted-foreground truncate max-w-[80px]">{course.instructor.name}</span>
        </div>

        {/* Description - Hidden in grid view for compactness */}
        {!isGrid && (
          <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
            {course.description}
          </p>
        )}

        {/* Stats & Progress */}
        <div className={cn("space-y-1.5", isGrid && "mt-auto")}>
          {/* Rating & Students */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-0.5">
              <Star data-testid="star-icon" className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span className="font-medium">{course.rating}</span>
            </div>
            <div className="flex items-center gap-0.5 text-muted-foreground">
              <Users className="w-3 h-3" />
              <span>{course.studentCount}</span>
            </div>
          </div>

          {/* Progress Bar */}
          {course.progress !== undefined && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>进度</span>
                <span>{course.progress}%</span>
              </div>
              <Progress
                value={course.progress}
                aria-label="学习进度"
                aria-valuenow={course.progress}
                className="h-1"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CourseListPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CourseCategory>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Fetch real courses from API
  const { courses: apiCourses, isLoading, error, refetch } = useCourses({
    category: selectedCategory,
  });

  // Fetch categories from API
  const { categories: apiCategories, isLoading: categoriesLoading } = useCategories();

  // Filter and sort courses
  const filteredCourses = useMemo(() => {
    let result = apiCourses;

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'popular':
          return b.studentCount - a.studentCount;
        case 'rating':
          return b.rating - a.rating;
        default:
          return 0;
      }
    });

    return result;
  }, [apiCourses, searchQuery, sortBy]);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-64 bg-card border-r border-border z-50 transition-transform duration-300',
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/')}
                className="shrink-0 p-2 rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                title="返回首页"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-xl font-bold text-[#722ed1]">课程中心</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭菜单"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <nav className="p-4 space-y-1">
          {/* All Courses Button */}
          <button
            onClick={() => setSelectedCategory('all')}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
              selectedCategory === 'all'
                ? 'bg-[#722ed1]/10 text-[#722ed1]'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <BookOpen className="w-5 h-5" />
            <span>全部课程</span>
          </button>

          {/* Categories from API */}
          {categoriesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            apiCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.name as CourseCategory)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                  selectedCategory === category.name
                    ? 'bg-[#722ed1]/10 text-[#722ed1]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <span className="w-5 h-5 flex items-center justify-center text-sm">
                  {category.name.charAt(0)}
                </span>
                <span>{category.name}</span>
              </button>
            ))
          )}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-4 p-4">
            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开菜单"
            >
              <Menu className="w-5 h-5" />
            </Button>

            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索课程..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* View Toggle & Sort */}
            <div className="flex items-center gap-2 ml-auto">
              {/* View Mode Toggle */}
              <div className="flex items-center bg-muted rounded-lg p-1">
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  data-active={viewMode === 'grid'}
                  aria-label="网格视图"
                >
                  <Grid3X3 className="w-4 h-4" />
                  <span className="hidden sm:inline ml-1">网格</span>
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  data-active={viewMode === 'list'}
                  aria-label="列表视图"
                >
                  <List className="w-4 h-4" />
                  <span className="hidden sm:inline ml-1">列表</span>
                </Button>
              </div>

              {/* Sort Dropdown */}
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                <SelectTrigger className="w-[140px]" aria-label="排序">
                  <SelectValue placeholder="排序" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">最新发布</SelectItem>
                  <SelectItem value="popular">最热门</SelectItem>
                  <SelectItem value="rating">评分最高</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </header>

        {/* Course Grid/List */}
        <div className="p-4 sm:p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-[#722ed1]" />
              <span className="ml-2 text-muted-foreground">加载中...</span>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <BookOpen className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">加载失败</h3>
              <p className="text-sm text-muted-foreground/60">{error}</p>
            </div>
          ) : filteredCourses.length > 0 ? (
            <div
              className={cn(
                'grid gap-3',
                viewMode === 'grid'
                  ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                  : 'grid-cols-1'
              )}
            >
              {filteredCourses.map((course) => (
                <CourseCard key={course.id} course={course} viewMode={viewMode} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <BookOpen className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">暂无课程</h3>
              <p className="text-sm text-muted-foreground/60 mb-4">尝试调整搜索条件或筛选器</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
