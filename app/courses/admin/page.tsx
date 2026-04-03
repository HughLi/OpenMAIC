'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Menu,
  X,
  BookOpen,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Layers,
  Loader2,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useAdminCourses, deleteCourse, updateCourse, type Course } from '@/lib/hooks/use-courses';
import { useAdminCategories } from '@/lib/hooks/use-categories';
import { UserManagement } from './components/user-management';
import { CourseImportMenu } from '../components/course-import-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { CourseStats } from '../types';

const navItems = [
  { id: 'courses', name: '课程管理', icon: BookOpen },
  { id: 'categories', name: '分类管理', icon: Layers },
  { id: 'users', name: '用户管理', icon: Users },
  { id: 'settings', name: '设置', icon: Settings },
];

interface AdminDashboardPageProps {
  initialStats?: CourseStats;
  initialCourses?: Course[];
}

export default function AdminDashboardPage({
  initialStats,
  initialCourses,
}: AdminDashboardPageProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('courses');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch categories from API
  const {
    categories,
    isLoading: categoriesLoading,
    setCategories,
    refetch: refetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useAdminCategories();

  // Category management state
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{
    id: string;
    name: string;
    description?: string;
    sortOrder: number;
    isActive: boolean;
  } | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    sortOrder: 0,
  });
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isDeletingCategory, setIsDeletingCategory] = useState(false);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    category: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch real courses from API
  const { courses, stats, isLoading, error, refetch } = useAdminCourses(statusFilter);

  // Use mock stats as fallback (non-profit project, no revenue)
  const displayStats: CourseStats = initialStats || {
    totalCourses: stats?.totalCourses ?? 0,
    totalStudents: 42590,
    completionRate: 78.4,
  };

  // Filter courses by search query
  const filteredCourses = useMemo(() => {
    let result = courses;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((c) => c.title.toLowerCase().includes(query));
    }

    return result;
  }, [courses, searchQuery]);

  // Handle edit button click
  const handleEdit = (course: Course) => {
    setEditingCourse(course);
    setEditForm({
      title: course.title,
      description: course.description,
      category: course.category,
    });
    setEditDialogOpen(true);
  };

  // Handle save edit
  const handleSaveEdit = async () => {
    if (!editingCourse) return;

    setIsSaving(true);
    const result = await updateCourse(editingCourse.id, {
      title: editForm.title,
      description: editForm.description,
      category: editForm.category,
    });

    if (result.success) {
      setEditDialogOpen(false);
      refetch();
    } else {
      alert(result.error || '更新失败');
    }
    setIsSaving(false);
  };

  // Handle toggle visibility
  const handleToggleVisibility = async (course: Course) => {
    const newVisibility = course.visibility === 'public' ? 'private' : 'public';
    const result = await updateCourse(course.id, {
      visibility: newVisibility,
    });

    if (result.success) {
      refetch();
    } else {
      alert(result.error || '更新可见性失败');
    }
  };

  // Handle delete button click
  const handleDeleteClick = (course: Course) => {
    setDeletingCourse(course);
    setDeleteDialogOpen(true);
  };

  // Handle confirm delete
  const handleConfirmDelete = async () => {
    if (!deletingCourse) return;

    setIsDeleting(true);
    const result = await deleteCourse(deletingCourse.id);

    if (result.success) {
      setDeleteDialogOpen(false);
      refetch();
    } else {
      alert(result.error || '删除失败');
    }
    setIsDeleting(false);
  };

  // Category management handlers
  const handleEditCategory = (category: {
    id: string;
    name: string;
    description?: string;
    sortOrder: number;
    isActive: boolean;
  }) => {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      description: category.description || '',
      sortOrder: category.sortOrder,
    });
    setCategoryDialogOpen(true);
  };

  const handleCreateCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', description: '', sortOrder: 0 });
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async () => {
    setIsSavingCategory(true);

    if (editingCategory) {
      // Update existing category
      const result = await updateCategory(editingCategory.id, {
        name: categoryForm.name,
        description: categoryForm.description,
        sortOrder: categoryForm.sortOrder,
        isActive: editingCategory.isActive,
      });

      if (!result.success) {
        alert(result.error?.message || '更新分类失败');
      }
    } else {
      // Create new category
      const result = await createCategory({
        name: categoryForm.name,
        description: categoryForm.description,
        sortOrder: categoryForm.sortOrder,
      });

      if (!result.success) {
        alert(result.error?.message || '创建分类失败');
      }
    }

    setIsSavingCategory(false);
    setCategoryDialogOpen(false);
  };

  const handleDeleteCategoryClick = (id: string, name: string) => {
    setDeletingCategory({ id, name });
    setDeleteCategoryDialogOpen(true);
  };

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory) return;

    setIsDeletingCategory(true);
    const result = await deleteCategory(deletingCategory.id);

    if (!result.success) {
      alert(result.error?.message || '删除分类失败');
    }

    setIsDeletingCategory(false);
    setDeleteCategoryDialogOpen(false);
  };

  // Handle move category up/down - single API call
  const handleMoveCategory = async (categoryId: string, direction: 'up' | 'down') => {
    const currentIndex = categories.findIndex((c) => c.id === categoryId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const currentCategory = categories[currentIndex];
    const targetCategory = categories[targetIndex];

    // Get auth token
    const token = localStorage.getItem('openmaic_tokens')
      ? JSON.parse(localStorage.getItem('openmaic_tokens')!).accessToken
      : null;

    if (!token) {
      alert('请先登录');
      return;
    }

    // Single API call to swap and get updated list
    try {
      const response = await fetch('/api/categories/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          categoryId1: currentCategory.id,
          categoryId2: targetCategory.id,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Update local state directly with returned categories
        setCategories(result.categories);
      } else {
        alert(result.error || '调整排序失败');
      }
    } catch {
      alert('调整排序失败');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
            ACTIVE
          </Badge>
        );
      case 'draft':
        return (
          <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">
            DRAFT
          </Badge>
        );
      case 'inactive':
        return (
          <Badge className="bg-gray-500/10 text-gray-600 hover:bg-gray-500/20">
            INACTIVE
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f9fb]">
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
          'fixed left-0 top-0 h-full w-64 bg-slate-900 text-white z-50 transition-transform duration-300',
          'lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/')}
                className="shrink-0 p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                title="返回首页"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-lg font-bold">The Scholarly</h1>
                <p className="text-xs text-slate-400">Editorial Dashboard</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-white hover:bg-slate-800"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <nav className="p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                  activeNav === item.id
                    ? 'bg-[#722ed1] text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>

        {/* Import/Export Section */}
        <div className="absolute bottom-20 left-0 right-0 p-4 border-t border-slate-800">
          <div className="space-y-2">
            <p className="text-xs text-slate-400 mb-2">数据管理</p>
            <CourseImportMenu
              onImportSuccess={() => refetch()}
              variant="dark"
              size="sm"
            />
          </div>
        </div>

        {/* User Profile */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#722ed1] flex items-center justify-center text-white font-medium">
              JD
            </div>
            <div>
              <p className="text-sm font-medium">John Doe</p>
              <p className="text-xs text-slate-400">Super Admin</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-border">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开菜单"
              >
                <Menu className="w-5 h-5" />
              </Button>
              <h2 className="text-xl font-semibold hidden sm:block">
                {activeNav === 'courses' && '课程管理'}
                {activeNav === 'categories' && '分类管理'}
                {activeNav === 'users' && '用户管理'}
                {activeNav === 'settings' && '系统设置'}
              </h2>
            </div>

            {activeNav === 'courses' && (
              <Button className="bg-[#722ed1] hover:bg-[#722ed1]/90 text-white">
                <Plus className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">新建课程</span>
                <span className="sm:hidden">新建</span>
              </Button>
            )}
            {activeNav === 'categories' && (
              <Button
                className="bg-[#722ed1] hover:bg-[#722ed1]/90 text-white"
                onClick={handleCreateCategory}
              >
                <Plus className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">新建分类</span>
                <span className="sm:hidden">新建</span>
              </Button>
            )}
          </div>
        </header>

        <div className="p-4 sm:p-6 space-y-6">
          {activeNav === 'courses' && (
            <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  总课程数
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold">{displayStats.totalCourses.toLocaleString()}</div>
                  <div className="flex items-center text-green-600 text-sm">
                    <TrendingUp className="w-4 h-4 mr-1" />
                    +5%
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  学员总数
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold">{displayStats.totalStudents.toLocaleString()}</div>
                  <div className="flex items-center text-green-600 text-sm">
                    <TrendingUp className="w-4 h-4 mr-1" />
                    +12%
                  </div>
                </div>
              </CardContent>
            </Card>


            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  完成率
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold">{displayStats.completionRate}%</div>
                  <div className="flex items-center text-red-500 text-sm">
                    <TrendingDown className="w-4 h-4 mr-1" />
                    -2%
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索课程..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]" aria-label="状态筛选">
                <SelectValue placeholder="状态筛选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">已发布</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="inactive">已下架</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Course Table */}
          <Card>
            <CardHeader>
              <CardTitle>Course Management</CardTitle>
            </CardHeader>
            <CardContent>
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
                  <Button onClick={refetch} className="mt-4 bg-[#722ed1] hover:bg-[#722ed1]/90">
                    重试
                  </Button>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto -mx-6 px-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[300px]">课程名称</TableHead>
                          <TableHead>作者</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>可见性</TableHead>
                          <TableHead>学员数</TableHead>
                          <TableHead className="hidden sm:table-cell">创建时间</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCourses.map((course) => (
                          <TableRow key={course.id}>
                            <TableCell>
                              <div className="flex items-center gap-4">
                                <div className="relative w-20 h-14 rounded-lg bg-gradient-to-br from-[#722ed1]/20 to-purple-300/20 flex items-center justify-center shrink-0 overflow-hidden">
                                  {course.coverImage ? (
                                    <Image
                                      src={course.coverImage}
                                      alt={course.title}
                                      fill
                                      className="object-cover"
                                    />
                                  ) : (
                                    <BookOpen className="w-6 h-6 text-[#722ed1]/60" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium line-clamp-2 leading-snug" title={course.title}>
                                    {course.title}
                                  </p>
                                  {course.sceneCount !== undefined && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {course.sceneCount} 个场景
                                    </p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm truncate">
                                {course.instructor?.name || 'Unknown'}
                              </span>
                            </TableCell>
                            <TableCell>{getStatusBadge(course.status)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={course.visibility === 'public'}
                                  onCheckedChange={() => handleToggleVisibility(course)}
                                  aria-label={course.visibility === 'public' ? '公开' : '私有'}
                                />
                                <span className="text-xs text-muted-foreground">
                                  {course.visibility === 'public' ? '公开' : '私有'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{course.studentCount.toLocaleString()}</TableCell>
                            <TableCell className="hidden sm:table-cell">{course.createdAt}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label="编辑"
                                  onClick={() => handleEdit(course)}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  aria-label="删除"
                                  onClick={() => handleDeleteClick(course)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      显示 {filteredCourses.length} 条记录
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        第 {currentPage} 页
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage((p) => p + 1)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Edit Dialog */}
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>编辑课程</DialogTitle>
                <DialogDescription>修改课程信息</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">课程名称</Label>
                  <Input
                    id="title"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    placeholder="输入课程名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">课程描述</Label>
                  <Textarea
                    id="description"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="输入课程描述"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">分类</Label>
                  <Select
                    value={editForm.category}
                    onValueChange={(value) => setEditForm({ ...editForm, category: value })}
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
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={handleSaveEdit}
                  disabled={isSaving}
                  className="bg-[#722ed1] hover:bg-[#722ed1]/90"
                >
                  {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>确认删除</DialogTitle>
                <DialogDescription>
                  确定要删除课程「{deletingCourse?.title}」吗？此操作不可撤销。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  删除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
          )}

          {activeNav === 'categories' && (
            <>
              {/* Categories List */}
              <Card>
                <CardHeader>
                  <CardTitle>分类管理</CardTitle>
                </CardHeader>
                <CardContent>
                  {categoriesLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-8 h-8 animate-spin text-[#722ed1]" />
                      <span className="ml-2 text-muted-foreground">加载中...</span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto -mx-6 px-6">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>分类名称</TableHead>
                            <TableHead className="hidden sm:table-cell">描述</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {categories.map((category) => (
                            <TableRow key={category.id}>
                              <TableCell className="font-medium break-words whitespace-normal max-w-[120px] sm:max-w-[200px]">
                                {category.name}
                              </TableCell>
                              <TableCell className="text-muted-foreground hidden sm:table-cell">
                                {category.description || '-'}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={
                                    category.isActive
                                      ? 'bg-green-500/10 text-green-600'
                                      : 'bg-gray-500/10 text-gray-600'
                                  }
                                >
                                  {category.isActive ? '启用' : '停用'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleMoveCategory(category.id, 'up')}
                                    disabled={categories.findIndex((c) => c.id === category.id) === 0}
                                    title="上移"
                                  >
                                    <ArrowUp className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleMoveCategory(category.id, 'down')}
                                    disabled={categories.findIndex((c) => c.id === category.id) === categories.length - 1}
                                    title="下移"
                                  >
                                    <ArrowDown className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleEditCategory(category)}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteCategoryClick(category.id, category.name)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Category Edit/Create Dialog */}
              <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>
                      {editingCategory ? '编辑分类' : '新建分类'}
                    </DialogTitle>
                    <DialogDescription>
                      {editingCategory ? '修改分类信息' : '创建新的课程分类'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="cat-name">分类名称</Label>
                      <Input
                        id="cat-name"
                        value={categoryForm.name}
                        onChange={(e) =>
                          setCategoryForm({ ...categoryForm, name: e.target.value })
                        }
                        placeholder="输入分类名称"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cat-description">描述</Label>
                      <Textarea
                        id="cat-description"
                        value={categoryForm.description}
                        onChange={(e) =>
                          setCategoryForm({ ...categoryForm, description: e.target.value })
                        }
                        placeholder="输入分类描述"
                        rows={2}
                      />
                    </div>
                    {editingCategory && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="cat-active"
                          checked={editingCategory.isActive}
                          onChange={(e) =>
                            setEditingCategory({
                              ...editingCategory,
                              isActive: e.target.checked,
                            })
                          }
                          className="rounded border-gray-300"
                        />
                        <Label htmlFor="cat-active">启用</Label>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>
                      取消
                    </Button>
                    <Button
                      onClick={handleSaveCategory}
                      disabled={isSavingCategory}
                      className="bg-[#722ed1] hover:bg-[#722ed1]/90"
                    >
                      {isSavingCategory && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      保存
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Category Delete Confirmation Dialog */}
              <Dialog open={deleteCategoryDialogOpen} onOpenChange={setDeleteCategoryDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                  <DialogHeader>
                    <DialogTitle>确认删除</DialogTitle>
                    <DialogDescription>
                      确定要删除分类「{deletingCategory?.name}」吗？此操作不可撤销。
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteCategoryDialogOpen(false)}>
                      取消
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleConfirmDeleteCategory}
                      disabled={isDeletingCategory}
                    >
                      {isDeletingCategory && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      删除
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}

          {activeNav === 'users' && <UserManagement />}

          {activeNav === 'settings' && (
            <Card>
              <CardHeader>
                <CardTitle>系统设置</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-20 text-muted-foreground">
                  <Settings className="w-16 h-16 mx-auto mb-4 opacity-40" />
                  <p>系统设置功能开发中...</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
