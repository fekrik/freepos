import { PrismaClient, type SoldBy } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { gs1CheckDigit, normalizeGtin } from '@freshpos/shared';

const db = new PrismaClient();
const upc = (body11: string) => body11 + gs1CheckDigit(body11);

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Fresh Market Supermarket', slug: 'demo' },
  });
  const t = tenant.id;

  let store = await db.store.findFirst({ where: { tenantId: t, name: 'Main Street Supermarket' } });
  store ??= await db.store.create({
    data: {
      tenantId: t,
      name: 'Main Street Supermarket',
      address: '100 Main St, Springfield, MA',
      fnsNumber: '1234567',
      registers: {
        create: [
          { name: 'Lane 1 - Express' },
          { name: 'Lane 2 - Self-Checkout' },
          { name: 'Lane 3 - Full Service' },
        ],
      },
    },
  });

  const pw = await bcrypt.hash('admin123', 10);
  const users = [
    { name: 'Alex Admin', role: 'admin', employeeNo: '1000', pin: '1000', email: 'admin@demo.com' },
    { name: 'Sam Supervisor', role: 'supervisor', employeeNo: '2000', pin: '2000', email: 'supervisor@demo.com' },
    { name: 'Casey Cashier', role: 'cashier', employeeNo: '3000', pin: '3000' },
    { name: 'Morgan Cashier', role: 'cashier', employeeNo: '3001', pin: '3001' },
  ] as const;

  for (const u of users) {
    const user = await db.user.upsert({
      where: { tenantId_employeeNo: { tenantId: t, employeeNo: u.employeeNo } },
      update: {},
      create: {
        tenantId: t,
        name: u.name,
        role: u.role,
        employeeNo: u.employeeNo,
        pinHash: await bcrypt.hash(u.pin, 10),
        email: 'email' in u ? u.email : null,
        passwordHash: 'email' in u ? pw : null,
      },
    });
    await db.userStore.upsert({
      where: { userId_storeId: { userId: user.id, storeId: store.id } },
      update: {},
      create: { userId: user.id, storeId: store.id },
    });
  }

  const dept = async (code: string, name: string) =>
    db.department.upsert({ where: { tenantId_code: { tenantId: t, code } }, update: {}, create: { tenantId: t, code, name } });
  const tax = async (name: string, rateBps: number) =>
    db.taxClass.upsert({ where: { tenantId_name: { tenantId: t, name } }, update: {}, create: { tenantId: t, name, rateBps } });

  const [
    produce, dairy, bakery, meat, grocery, beverages, snacks, frozen, household, personal, alcohol
  ] = await Promise.all([
    dept('PRD', 'Fresh Produce'),
    dept('DRY', 'Dairy & Eggs'),
    dept('BKY', 'Bakery'),
    dept('MEA', 'Meat, Seafood & Deli'),
    dept('GRO', 'Pantry & Grocery'),
    dept('BEV', 'Beverages'),
    dept('SNK', 'Snacks & Confectionery'),
    dept('FRZ', 'Frozen Foods'),
    dept('HH', 'Household & Paper'),
    dept('HBA', 'Health & Beauty'),
    dept('ALC', 'Beer & Wine (21+)'),
  ]);

  const [food, general] = await Promise.all([
    tax('Grocery (Exempt)', 0),
    tax('General Merchandise', 700), // 7.00%
  ]);

  type SeedItem = {
    name: string;
    brand?: string;
    d: string;
    tx: string;
    price: number;
    soldBy?: SoldBy;
    snap?: boolean;
    wic?: boolean;
    plu?: string;
    upc?: string;
    minAge?: number;
    deposit?: number;
    onHand?: number;
  };

  const items: SeedItem[] = [
    // --- Fresh Produce (PLU weighted or per each) ---
    { name: 'Cavendish Bananas', d: produce.id, tx: food.id, price: 69, soldBy: 'weight', snap: true, wic: true, plu: '4011' },
    { name: 'Organic Bananas', d: produce.id, tx: food.id, price: 99, soldBy: 'weight', snap: true, wic: true, plu: '94011' },
    { name: 'Honeycrisp Apples', d: produce.id, tx: food.id, price: 299, soldBy: 'weight', snap: true, wic: true, plu: '3283' },
    { name: 'Gala Apples', d: produce.id, tx: food.id, price: 199, soldBy: 'weight', snap: true, wic: true, plu: '4133' },
    { name: 'Hass Avocados', d: produce.id, tx: food.id, price: 129, soldBy: 'each', snap: true, plu: '4046' },
    { name: 'Roma Plum Tomatoes', d: produce.id, tx: food.id, price: 179, soldBy: 'weight', snap: true, plu: '4087' },
    { name: 'English Cucumber', d: produce.id, tx: food.id, price: 149, soldBy: 'each', snap: true, plu: '4593' },
    { name: 'Yellow Onions', d: produce.id, tx: food.id, price: 119, soldBy: 'weight', snap: true, plu: '4093' },
    { name: 'Broccoli Crowns', d: produce.id, tx: food.id, price: 229, soldBy: 'weight', snap: true, plu: '3082' },
    { name: 'Fresh Strawberries 1lb', brand: 'Driscolls', d: produce.id, tx: food.id, price: 399, snap: true, wic: true, upc: upc('07000000010') },
    { name: 'Russet Potatoes 5lb Bag', brand: 'Green Earth', d: produce.id, tx: food.id, price: 449, snap: true, wic: true, upc: upc('07000000011') },

    // --- Dairy & Eggs ---
    { name: 'Whole Milk 1 Gallon', brand: 'Valley Farms', d: dairy.id, tx: food.id, price: 429, snap: true, wic: true, upc: upc('07000000001') },
    { name: '2% Reduced Fat Milk 1 Gal', brand: 'Valley Farms', d: dairy.id, tx: food.id, price: 419, snap: true, wic: true, upc: upc('07000000012') },
    { name: 'Oat Milk Original 64oz', brand: 'Oatpure', d: dairy.id, tx: food.id, price: 499, snap: true, upc: upc('07000000013') },
    { name: 'Large White Eggs Grade A 12ct', brand: 'Valley Farms', d: dairy.id, tx: food.id, price: 349, snap: true, wic: true, upc: upc('07000000002') },
    { name: 'Organic Pasture Raised Eggs 12ct', brand: 'Vital Farms', d: dairy.id, tx: food.id, price: 629, snap: true, upc: upc('07000000014') },
    { name: 'Sweet Cream Butter 16oz (4 sticks)', brand: 'Land O Lakes', d: dairy.id, tx: food.id, price: 489, snap: true, upc: upc('07000000015') },
    { name: 'Greek Plain Yogurt 32oz', brand: 'Fage', d: dairy.id, tx: food.id, price: 549, snap: true, wic: true, upc: upc('07000000016') },
    { name: 'Sharp Cheddar Cheese Bar 8oz', brand: 'Cabot', d: dairy.id, tx: food.id, price: 379, snap: true, upc: upc('07000000017') },
    { name: 'Shredded Mozzarella Cheese 8oz', brand: 'Kraft', d: dairy.id, tx: food.id, price: 329, snap: true, upc: upc('07000000018') },

    // --- Bakery ---
    { name: 'Artisan Sourdough Boule', brand: 'In-Store Bakery', d: bakery.id, tx: food.id, price: 549, snap: true, upc: upc('07000000003') },
    { name: '100% Whole Wheat Sandwich Bread', brand: 'Nature Own', d: bakery.id, tx: food.id, price: 389, snap: true, wic: true, upc: upc('07000000019') },
    { name: 'Butter Croissants 4-Pack', brand: 'In-Store Bakery', d: bakery.id, tx: food.id, price: 499, snap: true, upc: upc('07000000020') },
    { name: 'Everything Bagels 6-Pack', brand: 'Thomas', d: bakery.id, tx: food.id, price: 429, snap: true, upc: upc('07000000021') },

    // --- Meat, Seafood & Deli ---
    { name: 'Deli Sliced Oven Roasted Turkey', brand: 'Boars Head', d: meat.id, tx: food.id, price: 1199, soldBy: 'weight', snap: true, plu: '12345' },
    { name: 'Deli Sliced Roast Beef', brand: 'Boars Head', d: meat.id, tx: food.id, price: 1499, soldBy: 'weight', snap: true, plu: '12346' },
    { name: 'Boneless Skinless Chicken Breasts', brand: 'Perdue', d: meat.id, tx: food.id, price: 449, soldBy: 'weight', snap: true, plu: '20101' },
    { name: '80/20 Ground Beef Chuck', brand: 'Certified Angus', d: meat.id, tx: food.id, price: 599, soldBy: 'weight', snap: true, plu: '20202' },
    { name: 'Fresh Atlantic Salmon Fillet', brand: 'Ocean Catch', d: meat.id, tx: food.id, price: 1199, soldBy: 'weight', snap: true, plu: '20303' },
    { name: 'Thick Cut Applewood Bacon 16oz', brand: 'Wright Brand', d: meat.id, tx: food.id, price: 799, snap: true, upc: upc('07000000022') },

    // --- Beverages ---
    { name: 'Classic Cola 12-Pack Cans', brand: 'Fizz Cola', d: beverages.id, tx: general.id, price: 749, snap: true, deposit: 60, upc: upc('07000000004') },
    { name: 'Diet Cola 12-Pack Cans', brand: 'Fizz Cola', d: beverages.id, tx: general.id, price: 749, snap: true, deposit: 60, upc: upc('07000000023') },
    { name: 'Sparkling Mineral Water 1L', brand: 'San Pellegrino', d: beverages.id, tx: general.id, price: 229, snap: true, deposit: 5, upc: upc('07000000024') },
    { name: '100% Pure Squeezed Orange Juice 52oz', brand: 'Tropicana', d: beverages.id, tx: food.id, price: 469, snap: true, wic: true, upc: upc('07000000025') },
    { name: 'Cold Brew Coffee Unsweetened 32oz', brand: 'Stumptown', d: beverages.id, tx: general.id, price: 599, snap: true, deposit: 10, upc: upc('07000000026') },

    // --- Pantry & Grocery ---
    { name: 'Extra Virgin Olive Oil 500ml', brand: 'Colavita', d: grocery.id, tx: food.id, price: 899, snap: true, upc: upc('07000000027') },
    { name: 'Jasmine Rice 5lb Bag', brand: 'Three Rings', d: grocery.id, tx: food.id, price: 679, snap: true, upc: upc('07000000028') },
    { name: 'Italian Spaghetti 16oz', brand: 'Barilla', d: grocery.id, tx: food.id, price: 189, snap: true, upc: upc('07000000029') },
    { name: 'Traditional Marinara Sauce 24oz', brand: 'Raos Homemade', d: grocery.id, tx: food.id, price: 799, snap: true, upc: upc('07000000030') },
    { name: 'Creamy Peanut Butter 16oz', brand: 'Skippy', d: grocery.id, tx: food.id, price: 319, snap: true, wic: true, upc: upc('07000000031') },
    { name: 'Organic Strawberry Jam 14oz', brand: 'Bonne Maman', d: grocery.id, tx: food.id, price: 479, snap: true, upc: upc('07000000032') },

    // --- Snacks & Confectionery ---
    { name: 'Classic Salted Potato Chips 8oz', brand: 'Lays', d: snacks.id, tx: general.id, price: 429, snap: true, upc: upc('07000000033') },
    { name: 'Restaurant Style Tortilla Chips 13oz', brand: 'Tostitos', d: snacks.id, tx: general.id, price: 459, snap: true, upc: upc('07000000034') },
    { name: 'Roasted Whole Almonds 12oz', brand: 'Blue Diamond', d: snacks.id, tx: food.id, price: 599, snap: true, upc: upc('07000000035') },
    { name: 'Dark Chocolate Sea Salt Bar 3.5oz', brand: 'Lindt Excellence', d: snacks.id, tx: general.id, price: 349, snap: true, upc: upc('07000000036') },

    // --- Frozen Foods ---
    { name: 'Four Cheese Frozen Pizza 21oz', brand: 'Digiorno', d: frozen.id, tx: food.id, price: 729, snap: true, upc: upc('07000000037') },
    { name: 'Vanilla Bean Ice Cream 48oz', brand: 'Haagen-Dazs', d: frozen.id, tx: food.id, price: 589, snap: true, upc: upc('07000000038') },
    { name: 'Organic Triple Berry Blend 16oz', brand: 'Cascadian Farm', d: frozen.id, tx: food.id, price: 499, snap: true, upc: upc('07000000039') },

    // --- Household & Personal Care ---
    { name: 'Paper Towels Ultra 6 Double Rolls', brand: 'Bounty', d: household.id, tx: general.id, price: 1299, upc: upc('07000000005') },
    { name: 'Ultra Soft Bath Tissue 12 Mega Rolls', brand: 'Charmin', d: household.id, tx: general.id, price: 1549, upc: upc('07000000040') },
    { name: 'Ultra Dishwashing Liquid 19oz', brand: 'Dawn Platinum', d: household.id, tx: general.id, price: 349, upc: upc('07000000041') },
    { name: 'Laundry Detergent Pods 42ct', brand: 'Tide PODS', d: household.id, tx: general.id, price: 1399, upc: upc('07000000042') },
    { name: 'Total Whitening Toothpaste 5.1oz', brand: 'Colgate', d: personal.id, tx: general.id, price: 399, upc: upc('07000000043') },

    // --- Alcohol & Wine (21+ age verified) ---
    { name: 'Hazy Little Thing IPA 6-Pack', brand: 'Sierra Nevada', d: alcohol.id, tx: general.id, price: 1149, minAge: 21, deposit: 30, upc: upc('07000000006') },
    { name: 'Crisp Lager 12-Pack Bottles', brand: 'Stella Artois', d: alcohol.id, tx: general.id, price: 1699, minAge: 21, deposit: 60, upc: upc('07000000044') },
    { name: 'Cabernet Sauvignon 750ml', brand: 'Josh Cellars', d: alcohol.id, tx: general.id, price: 1499, minAge: 21, deposit: 10, upc: upc('07000000045') },
    { name: 'Sauvignon Blanc 750ml', brand: 'Kim Crawford', d: alcohol.id, tx: general.id, price: 1649, minAge: 21, deposit: 10, upc: upc('07000000046') },
    { name: 'Hard Seltzer Variety 12-Pack', brand: 'White Claw', d: alcohol.id, tx: general.id, price: 1799, minAge: 21, deposit: 60, upc: upc('07000000047') },
  ];

  console.log(`Seeding ${items.length} supermarket products...`);

  // Clean out existing demo transactions and catalog
  await db.drawerMovement.deleteMany({ where: { tenantId: t } });
  await db.payment.deleteMany({ where: { sale: { tenantId: t } } });
  await db.saleLine.deleteMany({ where: { sale: { tenantId: t } } });
  await db.sale.deleteMany({ where: { tenantId: t } });
  await db.shift.deleteMany({ where: { tenantId: t } });
  await db.barcode.deleteMany({ where: { tenantId: t } });
  await db.inventory.deleteMany({ where: { store: { tenantId: t } } });
  await db.storePrice.deleteMany({ where: { store: { tenantId: t } } });
  await db.product.deleteMany({ where: { tenantId: t } });

  for (const i of items) {
    await db.product.create({
      data: {
        tenantId: t,
        name: i.name,
        brand: i.brand,
        departmentId: i.d,
        taxClassId: i.tx,
        price: i.price,
        soldBy: i.soldBy ?? 'each',
        snapEligible: i.snap ?? false,
        wicEligible: i.wic ?? false,
        plu: i.plu,
        minAge: i.minAge,
        depositCents: i.deposit,
        barcodes: i.upc ? { create: { code: normalizeGtin(i.upc), tenantId: t } } : undefined,
        inventory: { create: { storeId: store.id, onHand: i.onHand ?? 150 } },
      },
    });
  }

  // Seed demo loyalty customers
  const customers = [
    { name: 'Sarah Connor', phone: '5550101', email: 'sarah@example.com', points: 340 },
    { name: 'David Miller', phone: '5550102', email: 'david@example.com', points: 120 },
    { name: 'Elena Rostova', phone: '5550103', email: 'elena@example.com', points: 550 },
  ];
  for (const c of customers) {
    await db.customer.upsert({
      where: { tenantId_phone: { tenantId: t, phone: c.phone } },
      update: { points: c.points },
      create: { tenantId: t, name: c.name, phone: c.phone, email: c.email, points: c.points },
    });
  }

  console.log(`\n✅ Database seed successful!`);
  console.log(`- Tenant: "Fresh Market Supermarket" (slug: demo)`);
  console.log(`- Store: "Main Street Supermarket"`);
  console.log(`- Products seeded: ${items.length}`);
  console.log(`- Loyalty customers seeded: ${customers.length}`);
  console.log(`- Back office: admin@demo.com / admin123`);
  console.log(`- Lane PINs: 1000 (Admin), 2000 (Supervisor), 3000 (Cashier Casey), 3001 (Cashier Morgan)`);
}

main().finally(() => db.$disconnect());
