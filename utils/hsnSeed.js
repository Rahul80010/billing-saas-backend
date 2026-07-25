const HsnMaster = require('../models/HsnMaster');

const defaultHsnRecords = [
  { hsnCode: '8517', category: 'Mobile Phones', productName: 'Mobile Phones & Wireless Communication', gstRate: 18, keywords: ['mobile', 'phone', 'smartphone', 'iphone', 'android', 'cellular', 'samsung', 'vivo', 'oppo', 'realme', 'redmi', 'oneplus', 'iqoo', 'poco'] },
  { hsnCode: '8504', category: 'Chargers & Adapters', productName: 'Chargers, Power Adapters & Power Banks', gstRate: 18, keywords: ['charger', 'adapter', 'powerbank', 'power bank', 'fast charger', 'type c cable', 'charging'] },
  { hsnCode: '1006', category: 'Rice', productName: 'Rice, Basmati Rice & Paddy', gstRate: 5, keywords: ['rice', 'chawal', 'basmati', 'paddy', 'grain'] },
  { hsnCode: '1905', category: 'Biscuits & Bakery', productName: 'Biscuits, Wafers, Cakes & Bakery Items', gstRate: 18, keywords: ['biscuit', 'cookies', 'wafer', 'cake', 'bakery', 'rusk', 'bread'] },
  { hsnCode: '6109', category: 'T-Shirts & Apparel', productName: 'T-Shirts, Singlets & Polo Shirts', gstRate: 5, keywords: ['t-shirt', 'tshirt', 'shirt', 'polo', 'top', 'garment', 'clothes'] },
  { hsnCode: '8471', category: 'Computers & Laptops', productName: 'Laptops, Desktop Computers, Tablets & Processing Units', gstRate: 18, keywords: ['laptop', 'computer', 'desktop', 'pc', 'tablet', 'macbook', 'cpu'] },
  { hsnCode: '6403', category: 'Footwear & Shoes', productName: 'Footwear, Leather Shoes & Sneakers', gstRate: 12, keywords: ['shoe', 'shoes', 'footwear', 'chappal', 'sandal', 'sneaker', 'boots'] },
  { hsnCode: '3004', category: 'Medicines & Pharma', productName: 'Medicines, Tablets, Syrups & Pharmaceuticals', gstRate: 12, keywords: ['medicine', 'tablet', 'capsule', 'syrup', 'pharma', 'drug', 'ointment'] },
  { hsnCode: '6204', category: 'Garments & Dresses', productName: 'Women Garments, Suits, Sarees & Dresses', gstRate: 5, keywords: ['saree', 'suit', 'dress', 'kurti', 'lehenga', 'garment', 'clothing'] },
  { hsnCode: '0910', category: 'Spices', productName: 'Spices, Turmeric, Cumin & Spices Powder', gstRate: 5, keywords: ['spice', 'masala', 'haldi', 'turmeric', 'jeera', 'chilli', 'mirch'] },
  { hsnCode: '0401', category: 'Dairy & Milk', productName: 'Fresh Milk, Curd, Butter & Dairy Items', gstRate: 5, keywords: ['milk', 'doodh', 'curd', 'dahi', 'butter', 'paneer', 'dairy'] },
  { hsnCode: '8528', category: 'Televisions & Displays', productName: 'Smart TVs, LED Televisions & Monitors', gstRate: 18, keywords: ['tv', 'television', 'led tv', 'smart tv', 'monitor', 'screen', 'display'] },
  { hsnCode: '0709', category: 'Fresh Vegetables', productName: 'Fresh Vegetables & Produce', gstRate: 0, keywords: ['vegetable', 'sabzi', 'potato', 'onion', 'tomato'] },
  { hsnCode: '2523', category: 'Building Materials', productName: 'Portland Cement & Building Cement', gstRate: 28, keywords: ['cement', 'building material', 'ultratech', 'acc', 'ambuja'] },
  { hsnCode: '7214', category: 'Steel & Iron', productName: 'Iron & Steel Bars, Rebars & Rods', gstRate: 18, keywords: ['steel', 'iron', 'sariya', 'rebar', 'rod', 'metal'] },
  { hsnCode: '4820', category: 'Stationery & Paper', productName: 'Registers, Notebooks, Diaries & Exercise Books', gstRate: 12, keywords: ['notebook', 'register', 'diary', 'copy', 'paper', 'stationery'] },
  { hsnCode: '8518', category: 'Audio & Accessories', productName: 'Headphones, Earphones, TWS & Speakers', gstRate: 18, keywords: ['earphone', 'headphone', 'tws', 'airpods', 'earbuds', 'speaker', 'bluetooth speaker', 'soundbar'] },
  { hsnCode: '8507', category: 'Batteries', productName: 'Electric Batteries, Inverter Batteries & Accumulators', gstRate: 28, keywords: ['battery', 'inverter battery', 'exide', 'luminous', 'accumulator'] },
  { hsnCode: '8544', category: 'Cables & Wires', productName: 'Insulated Electrical Cables, Wires & Connectors', gstRate: 18, keywords: ['wire', 'cable', 'electrical wire', 'copper wire', 'polycab', 'finolex'] },
  { hsnCode: '3304', category: 'Beauty & Cosmetics', productName: 'Skincare, Makeup & Cosmetic Products', gstRate: 18, keywords: ['cosmetic', 'makeup', 'cream', 'lotion', 'lipstick', 'face wash', 'beauty'] },
  { hsnCode: '3401', category: 'Soaps & Detergents', productName: 'Toilet Soaps, Bath Soaps & Detergent Powder', gstRate: 18, keywords: ['soap', 'detergent', 'surf', 'washing powder', 'shampoo', 'handwash'] },
  { hsnCode: '0902', category: 'Tea & Coffee', productName: 'Tea Leaves, Black Tea & Green Tea', gstRate: 5, keywords: ['tea', 'chai', 'green tea', 'tata tea'] },
  { hsnCode: '0901', category: 'Tea & Coffee', productName: 'Coffee Powder & Coffee Beans', gstRate: 5, keywords: ['coffee', 'nescafe', 'bru', 'coffee powder'] },
  { hsnCode: '2202', category: 'Beverages', productName: 'Packaged Drinking Water & Soft Drinks', gstRate: 18, keywords: ['water', 'bisleri', 'soft drink', 'coke', 'pepsi', 'cold drink', 'juice'] },
  { hsnCode: '8415', category: 'Home Appliances', productName: 'Air Conditioners & AC Units', gstRate: 28, keywords: ['ac', 'air conditioner', 'split ac', 'window ac'] },
  { hsnCode: '8418', category: 'Home Appliances', productName: 'Refrigerators & Deep Freezers', gstRate: 18, keywords: ['refrigerator', 'fridge', 'deep freezer'] },
  { hsnCode: '8450', category: 'Home Appliances', productName: 'Washing Machines & Dryers', gstRate: 18, keywords: ['washing machine', 'dryer'] },
  { hsnCode: '9403', category: 'Furniture', productName: 'Wooden & Metal Tables, Chairs & Office Furniture', gstRate: 18, keywords: ['furniture', 'table', 'chair', 'bed', 'sofa', 'desk', 'almirah'] },
  { hsnCode: '3926', category: 'Plastics', productName: 'Plastic Household Articles & Containers', gstRate: 18, keywords: ['plastic', 'bucket', 'container', 'jug', 'bottle', 'mug'] },
  { hsnCode: '9503', category: 'Toys & Games', productName: 'Toys, Puzzles & Children Board Games', gstRate: 12, keywords: ['toy', 'toys', 'game', 'puzzle', 'doll', 'car'] },
  { hsnCode: '9004', category: 'Eyewear', productName: 'Spectacles, Sunglasses & Optical Frames', gstRate: 12, keywords: ['spectacles', 'chashma', 'sunglasses', 'goggles', 'frames', 'lens'] },
  { hsnCode: '9102', category: 'Watches & Clocks', productName: 'Wrist Watches, Smartwatches & Wall Clocks', gstRate: 18, keywords: ['watch', 'smartwatch', 'clock', 'titan', 'fastrack'] },
  { hsnCode: '4202', category: 'Bags & Luggage', productName: 'Handbags, Backpacks, Trolley Bags & Luggage', gstRate: 18, keywords: ['bag', 'backpack', 'handbag', 'trolley', 'suitcase', 'luggage'] },
  { hsnCode: '7113', category: 'Jewellery', productName: 'Gold, Silver & Diamond Jewellery Ornaments', gstRate: 3, keywords: ['jewellery', 'gold', 'silver', 'diamond', 'ring', 'chain', 'necklace'] },
  { hsnCode: '2710', category: 'Automobile', productName: 'Engine Oils, Lubricants & Motor Oils', gstRate: 18, keywords: ['engine oil', 'lubricant', 'mobil', 'castrol', 'oil'] },
  { hsnCode: '8708', category: 'Automobile', productName: 'Automobile Spare Parts & Accessories', gstRate: 28, keywords: ['spare parts', 'auto parts', 'car parts', 'bike parts', 'helmet'] },
  { hsnCode: '6907', category: 'Building Materials', productName: 'Ceramic Floor & Wall Tiles', gstRate: 18, keywords: ['tiles', 'flooring', 'marbonite', 'granite', 'marble'] },
  { hsnCode: '3209', category: 'Hardware & Paints', productName: 'Asian Paints, Wall Paints & Enamels', gstRate: 18, keywords: ['paint', 'asian paints', 'primer', 'distemper', 'varnish'] },
  { hsnCode: '8301', category: 'Hardware & Paints', productName: 'Padlocks, Door Locks & Hardware Handles', gstRate: 18, keywords: ['lock', 'padlock', 'godrej lock', 'key', 'handle', 'hinge'] },
  { hsnCode: '9608', category: 'Stationery & Paper', productName: 'Pens, Ballpoint Pens & Markers', gstRate: 12, keywords: ['pen', 'ballpen', 'marker', 'pencil', 'ink'] },
];

const seedHsnMaster = async () => {
  try {
    const count = await HsnMaster.countDocuments();
    if (count === 0) {
      await HsnMaster.insertMany(defaultHsnRecords);
      console.log(`Seeded ${defaultHsnRecords.length} default HSN Master records successfully.`);
    }
  } catch (err) {
    console.error('Error seeding HSN Master:', err.message);
  }
};

module.exports = { seedHsnMaster, defaultHsnRecords };
