import { Prisma } from '@prisma/client';

import { AdminCafesService } from './admin-cafes.service';

describe('AdminCafesService menu Arabic titles', () => {
  const now = new Date('2026-08-03T00:00:00.000Z');

  const prisma = {
    cafeMenuCategory: {
      create: jest.fn(),
      update: jest.fn(),
    },
    cafeMenuSubcategory: {
      create: jest.fn(),
      update: jest.fn(),
    },
    cafeMenuItem: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    cafeMenuItemVariant: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const service = new AdminCafesService(prisma as never, {
    uploadDataUrl: jest.fn(),
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service as never, 'requireCafe' as never).mockResolvedValue({ id: 'cafe-1' } as never);
    jest
      .spyOn(service as never, 'requireCategory' as never)
      .mockResolvedValue({ id: 'cat-1' } as never);
    jest
      .spyOn(service as never, 'requireSubcategory' as never)
      .mockResolvedValue({ id: 'sub-1' } as never);
    jest
      .spyOn(service as never, 'requireSubcategoryById' as never)
      .mockResolvedValue({ id: 'sub-1' } as never);
    jest.spyOn(service as never, 'requireItem' as never).mockResolvedValue({ id: 'item-1' } as never);

    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
  });

  describe('category', () => {
    it('createCategory persists trimmed title_ar and returns title_ar', async () => {
      prisma.cafeMenuCategory.create.mockResolvedValue({
        id: 'cat-1',
        cafeId: 'cafe-1',
        titleEn: 'Hot drinks',
        titleAr: 'مشروبات ساخنة',
        imageMediaId: null,
        imageMedia: null,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        subcategories: [],
      });

      const result = await service.createCategory('cafe-1', {
        title_en: '  Hot drinks  ',
        title_ar: '  مشروبات ساخنة  ',
      });

      expect(prisma.cafeMenuCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cafeId: 'cafe-1',
            titleEn: 'Hot drinks',
            titleAr: 'مشروبات ساخنة',
          }),
        }),
      );
      expect(result.data.category.title_en).toBe('Hot drinks');
      expect(result.data.category.title_ar).toBe('مشروبات ساخنة');
    });

    it('createCategory maps blank title_ar to null', async () => {
      prisma.cafeMenuCategory.create.mockResolvedValue({
        id: 'cat-2',
        cafeId: 'cafe-1',
        titleEn: 'Snacks',
        titleAr: null,
        imageMediaId: null,
        imageMedia: null,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        subcategories: [],
      });

      const result = await service.createCategory('cafe-1', {
        title_en: 'Snacks',
        title_ar: '   ',
      });

      expect(prisma.cafeMenuCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titleEn: 'Snacks',
            titleAr: null,
          }),
        }),
      );
      expect(result.data.category.title_ar).toBeNull();
    });

    it('updateCategory maps empty title_ar to null', async () => {
      prisma.cafeMenuCategory.update.mockResolvedValue({
        id: 'cat-1',
        cafeId: 'cafe-1',
        titleEn: 'Hot drinks',
        titleAr: null,
        imageMediaId: null,
        imageMedia: null,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        subcategories: [],
      });

      const result = await service.updateCategory('cafe-1', 'cat-1', {
        title_en: 'Hot drinks',
        title_ar: '',
      });

      expect(prisma.cafeMenuCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cat-1' },
          data: expect.objectContaining({
            titleEn: 'Hot drinks',
            titleAr: null,
          }),
        }),
      );
      expect(result.data.category.title_ar).toBeNull();
    });

    it('updateCategory persists Arabic title', async () => {
      prisma.cafeMenuCategory.update.mockResolvedValue({
        id: 'cat-1',
        cafeId: 'cafe-1',
        titleEn: 'Hot drinks',
        titleAr: 'مشروبات',
        imageMediaId: null,
        imageMedia: null,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        subcategories: [],
      });

      const result = await service.updateCategory('cafe-1', 'cat-1', {
        title_en: 'Hot drinks',
        title_ar: 'مشروبات',
      });

      expect(result.data.category.title_ar).toBe('مشروبات');
    });
  });

  describe('subcategory', () => {
    it('createSubcategory persists trimmed title_ar and returns title_ar', async () => {
      prisma.cafeMenuSubcategory.create.mockResolvedValue({
        id: 'sub-1',
        categoryId: 'cat-1',
        titleEn: 'Coffee',
        titleAr: 'قهوة',
        imageMediaId: null,
        imageMedia: null,
        isUngrouped: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        items: [],
      });

      const result = await service.createSubcategory('cafe-1', 'cat-1', {
        title_en: ' Coffee ',
        title_ar: ' قهوة ',
      });

      expect(prisma.cafeMenuSubcategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            categoryId: 'cat-1',
            titleEn: 'Coffee',
            titleAr: 'قهوة',
            isUngrouped: false,
          }),
        }),
      );
      expect(result.data.subcategory.title_en).toBe('Coffee');
      expect(result.data.subcategory.title_ar).toBe('قهوة');
    });

    it('createSubcategory maps omitted title_ar to null', async () => {
      prisma.cafeMenuSubcategory.create.mockResolvedValue({
        id: 'sub-2',
        categoryId: 'cat-1',
        titleEn: 'Tea',
        titleAr: null,
        imageMediaId: null,
        imageMedia: null,
        isUngrouped: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        items: [],
      });

      const result = await service.createSubcategory('cafe-1', 'cat-1', {
        title_en: 'Tea',
      });

      expect(prisma.cafeMenuSubcategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titleEn: 'Tea',
            titleAr: null,
          }),
        }),
      );
      expect(result.data.subcategory.title_ar).toBeNull();
    });

    it('updateSubcategory maps blank title_ar to null', async () => {
      prisma.cafeMenuSubcategory.update.mockResolvedValue({
        id: 'sub-1',
        categoryId: 'cat-1',
        titleEn: 'Coffee',
        titleAr: null,
        imageMediaId: null,
        imageMedia: null,
        isUngrouped: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        items: [],
      });

      const result = await service.updateSubcategory('cafe-1', 'cat-1', 'sub-1', {
        title_en: 'Coffee',
        title_ar: '  ',
      });

      expect(prisma.cafeMenuSubcategory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            titleEn: 'Coffee',
            titleAr: null,
          }),
        }),
      );
      expect(result.data.subcategory.title_ar).toBeNull();
    });

    it('updateSubcategory persists Arabic title', async () => {
      prisma.cafeMenuSubcategory.update.mockResolvedValue({
        id: 'sub-1',
        categoryId: 'cat-1',
        titleEn: 'Coffee',
        titleAr: 'قهوة عربية',
        imageMediaId: null,
        imageMedia: null,
        isUngrouped: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        items: [],
      });

      const result = await service.updateSubcategory('cafe-1', 'cat-1', 'sub-1', {
        title_en: 'Coffee',
        title_ar: 'قهوة عربية',
      });

      expect(result.data.subcategory.title_ar).toBe('قهوة عربية');
    });
  });

  describe('item', () => {
    it('createItem persists trimmed title_ar and returns title_ar', async () => {
      prisma.cafeMenuItem.create.mockResolvedValue({
        id: 'item-1',
        subcategoryId: 'sub-1',
        titleEn: 'Cappuccino',
        titleAr: 'كابتشينو',
        description: null,
        price: new Prisma.Decimal(18),
        currency: 'QAR',
        imageMediaId: null,
        imageMedia: null,
        isKot: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        variants: [],
      });

      const result = await service.createItem('cafe-1', 'sub-1', {
        title_en: ' Cappuccino ',
        title_ar: ' كابتشينو ',
        price: 18,
      });

      expect(prisma.cafeMenuItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subcategoryId: 'sub-1',
            titleEn: 'Cappuccino',
            titleAr: 'كابتشينو',
          }),
        }),
      );
      expect(result.data.item.title_en).toBe('Cappuccino');
      expect(result.data.item.title_ar).toBe('كابتشينو');
    });

    it('createItem maps blank title_ar to null', async () => {
      prisma.cafeMenuItem.create.mockResolvedValue({
        id: 'item-2',
        subcategoryId: 'sub-1',
        titleEn: 'Espresso',
        titleAr: null,
        description: null,
        price: new Prisma.Decimal(12),
        currency: 'QAR',
        imageMediaId: null,
        imageMedia: null,
        isKot: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        variants: [],
      });

      const result = await service.createItem('cafe-1', 'sub-1', {
        title_en: 'Espresso',
        title_ar: '',
        price: 12,
      });

      expect(prisma.cafeMenuItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titleEn: 'Espresso',
            titleAr: null,
          }),
        }),
      );
      expect(result.data.item.title_ar).toBeNull();
    });

    it('createItem persists variant title_ar values', async () => {
      prisma.cafeMenuItem.create.mockResolvedValue({
        id: 'item-3',
        subcategoryId: 'sub-1',
        titleEn: 'Latte',
        titleAr: 'لاتيه',
        description: null,
        price: new Prisma.Decimal(15),
        currency: 'QAR',
        imageMediaId: null,
        imageMedia: null,
        isKot: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        variants: [
          {
            id: 'var-1',
            itemId: 'item-3',
            titleEn: 'Small',
            titleAr: 'صغير',
            price: new Prisma.Decimal(15),
            sortOrder: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'var-2',
            itemId: 'item-3',
            titleEn: 'Large',
            titleAr: 'كبير',
            price: new Prisma.Decimal(22),
            sortOrder: 1,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      const result = await service.createItem('cafe-1', 'sub-1', {
        title_en: 'Latte',
        title_ar: 'لاتيه',
        price: 15,
        variants: [
          { title_en: ' Small ', title_ar: ' صغير ', price: 15 },
          { title_en: 'Large', title_ar: 'كبير', price: 22 },
        ],
      });

      expect(prisma.cafeMenuItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titleAr: 'لاتيه',
            variants: {
              create: [
                expect.objectContaining({
                  titleEn: 'Small',
                  titleAr: 'صغير',
                }),
                expect.objectContaining({
                  titleEn: 'Large',
                  titleAr: 'كبير',
                }),
              ],
            },
          }),
        }),
      );
      expect(result.data.item.title_ar).toBe('لاتيه');
      expect(result.data.item.variants).toEqual([
        expect.objectContaining({ title_en: 'Small', title_ar: 'صغير' }),
        expect.objectContaining({ title_en: 'Large', title_ar: 'كبير' }),
      ]);
    });

    it('updateItem maps empty title_ar to null', async () => {
      prisma.cafeMenuItem.update.mockResolvedValue({
        id: 'item-1',
        subcategoryId: 'sub-1',
        titleEn: 'Cappuccino',
        titleAr: null,
        description: null,
        price: new Prisma.Decimal(18),
        currency: 'QAR',
        imageMediaId: null,
        imageMedia: null,
        isKot: false,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        variants: [],
      });

      const result = await service.updateItem('cafe-1', 'sub-1', 'item-1', {
        title_en: 'Cappuccino',
        title_ar: '',
        price: 18,
      });

      expect(prisma.cafeMenuItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: expect.objectContaining({
            titleEn: 'Cappuccino',
            titleAr: null,
          }),
        }),
      );
      expect(result.data.item.title_ar).toBeNull();
    });

    it('updateItem persists Arabic title and variant title_ar', async () => {
      prisma.cafeMenuItemVariant.deleteMany.mockResolvedValue({ count: 1 });
      prisma.cafeMenuItem.update.mockResolvedValue({
        id: 'item-1',
        subcategoryId: 'sub-1',
        titleEn: 'Cappuccino',
        titleAr: 'كابتشينو',
        description: null,
        price: new Prisma.Decimal(16),
        currency: 'QAR',
        imageMediaId: null,
        imageMedia: null,
        isKot: true,
        sortOrder: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        variants: [
          {
            id: 'var-9',
            itemId: 'item-1',
            titleEn: 'Regular',
            titleAr: 'عادي',
            price: new Prisma.Decimal(16),
            sortOrder: 0,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      const result = await service.updateItem('cafe-1', 'sub-1', 'item-1', {
        title_en: 'Cappuccino',
        title_ar: 'كابتشينو',
        price: 16,
        is_kot: true,
        variants: [{ title_en: 'Regular', title_ar: ' عادي ', price: 16 }],
      });

      expect(prisma.cafeMenuItemVariant.deleteMany).toHaveBeenCalledWith({
        where: { itemId: 'item-1' },
      });
      expect(prisma.cafeMenuItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titleAr: 'كابتشينو',
            variants: {
              create: [
                expect.objectContaining({
                  titleEn: 'Regular',
                  titleAr: 'عادي',
                }),
              ],
            },
          }),
        }),
      );
      expect(result.data.item.title_ar).toBe('كابتشينو');
      expect(result.data.item.variants[0].title_ar).toBe('عادي');
    });
  });
});
