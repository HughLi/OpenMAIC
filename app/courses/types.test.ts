import { describe, it, expect } from 'vitest';
import type { Course, CourseCategory, CourseStats, ViewMode, SortOption } from './types';

describe('Course Types', () => {
  it('should define Course interface correctly', () => {
    const course: Course = {
      id: '1',
      title: 'Test Course',
      description: 'Test Description',
      coverImage: '/test.jpg',
      category: 'programming',
      instructor: {
        id: 'i1',
        name: 'Test Instructor',
        avatar: '/avatar.jpg',
        title: 'Teacher',
      },
      rating: 4.5,
      studentCount: 100,
      progress: 50,
      status: 'active',
      createdAt: '2024-01-01',
      price: 99,
    };

    expect(course.id).toBe('1');
    expect(course.title).toBe('Test Course');
    expect(course.category).toBe('programming');
    expect(course.instructor.name).toBe('Test Instructor');
  });

  it('should support all course categories', () => {
    const categories: CourseCategory[] = [
      'all',
      'programming',
      'design',
      'business',
      'data-science',
      'language',
    ];

    categories.forEach((cat) => {
      expect(typeof cat).toBe('string');
    });
  });

  it('should define CourseStats correctly', () => {
    const stats: CourseStats = {
      totalCourses: 100,
      totalStudents: 1000,
      totalRevenue: 50000,
      completionRate: 75.5,
    };

    expect(stats.totalCourses).toBe(100);
    expect(stats.completionRate).toBe(75.5);
  });

  it('should support view modes', () => {
    const viewModes: ViewMode[] = ['grid', 'list'];
    expect(viewModes).toContain('grid');
    expect(viewModes).toContain('list');
  });

  it('should support sort options', () => {
    const sortOptions: SortOption[] = ['newest', 'popular', 'rating', 'price'];
    expect(sortOptions).toContain('newest');
    expect(sortOptions).toContain('popular');
    expect(sortOptions).toContain('rating');
    expect(sortOptions).toContain('price');
  });
});

describe('Course Filtering Logic', () => {
  const mockCourses: Course[] = [
    {
      id: '1',
      title: 'React Course',
      description: 'Learn React',
      coverImage: '',
      category: 'programming',
      instructor: { id: 'i1', name: 'John', avatar: '' },
      rating: 4.8,
      studentCount: 1000,
      status: 'active',
      createdAt: '2024-01-15',
      price: 299,
    },
    {
      id: '2',
      title: 'Design Course',
      description: 'Learn Design',
      coverImage: '',
      category: 'design',
      instructor: { id: 'i2', name: 'Jane', avatar: '' },
      rating: 4.5,
      studentCount: 500,
      status: 'draft',
      createdAt: '2024-02-20',
      price: 199,
    },
  ];

  it('should filter courses by category', () => {
    const filtered = mockCourses.filter((c) => c.category === 'programming');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('React Course');
  });

  it('should filter courses by search query', () => {
    const query = 'react';
    const filtered = mockCourses.filter(
      (c) =>
        c.title.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query)
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('React Course');
  });

  it('should sort courses by student count', () => {
    const sorted = [...mockCourses].sort((a, b) => b.studentCount - a.studentCount);
    expect(sorted[0].studentCount).toBe(1000);
    expect(sorted[1].studentCount).toBe(500);
  });

  it('should sort courses by rating', () => {
    const sorted = [...mockCourses].sort((a, b) => b.rating - a.rating);
    expect(sorted[0].rating).toBe(4.8);
    expect(sorted[1].rating).toBe(4.5);
  });

  it('should sort courses by date', () => {
    const sorted = [...mockCourses].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    expect(sorted[0].id).toBe('2'); // Feb 20 > Jan 15
  });
});
