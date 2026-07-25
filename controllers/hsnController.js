const HsnMaster = require('../models/HsnMaster');
const { seedHsnMaster } = require('../utils/hsnSeed');

// Helper to ensure database is seeded on first query
const ensureHsnSeeded = async () => {
  const count = await HsnMaster.countDocuments();
  if (count === 0) {
    await seedHsnMaster();
  }
};

// @desc    Search HSN codes by query (code, category, product name, keywords)
// @route   GET /api/hsn/search
// @access  Private
const searchHsn = async (req, res) => {
  try {
    await ensureHsnSeeded();
    const { q } = req.query;

    if (!q || !q.trim()) {
      // Return top popular HSN entries if search query is empty
      const popular = await HsnMaster.find({ status: 'active' }).limit(15);
      return res.json(popular);
    }

    const cleanQuery = q.trim();
    const regex = new RegExp(cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const results = await HsnMaster.find({
      status: 'active',
      $or: [
        { hsnCode: { $regex: regex } },
        { category: { $regex: regex } },
        { productName: { $regex: regex } },
        { keywords: { $in: [cleanQuery.toLowerCase()] } },
        { keywords: { $regex: regex } }
      ]
    }).limit(20);

    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Auto suggest HSN Code based on category or product name
// @route   GET /api/hsn/suggest
// @access  Private
const autoSuggestHsn = async (req, res) => {
  try {
    await ensureHsnSeeded();
    const { category, name } = req.query;

    if (!category && !name) {
      return res.json({ suggestion: null });
    }

    let match = null;

    // 1. Exact Category match
    if (category && category.trim()) {
      const catRegex = new RegExp(`^${category.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      match = await HsnMaster.findOne({ status: 'active', category: { $regex: catRegex } });
    }

    // 2. Category partial match
    if (!match && category && category.trim()) {
      const catRegex = new RegExp(category.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match = await HsnMaster.findOne({ status: 'active', category: { $regex: catRegex } });
    }

    // 3. Product Name keyword match
    if (!match && name && name.trim()) {
      const words = name.trim().toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      if (words.length > 0) {
        match = await HsnMaster.findOne({
          status: 'active',
          $or: [
            { keywords: { $in: words } },
            { productName: { $regex: new RegExp(words[0], 'i') } }
          ]
        });
      }
    }

    res.json({ suggestion: match });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all HSN Master records
// @route   GET /api/hsn
// @access  Private
const getAllHsn = async (req, res) => {
  try {
    await ensureHsnSeeded();
    const { search } = req.query;
    let query = {};
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { hsnCode: { $regex: regex } },
        { category: { $regex: regex } },
        { productName: { $regex: regex } }
      ];
    }
    const records = await HsnMaster.find(query).sort({ hsnCode: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new HSN Master record (Prevents duplicates)
// @route   POST /api/hsn
// @access  Private
const createHsn = async (req, res) => {
  try {
    const { hsnCode, category, productName, gstRate, description, keywords, status } = req.body;

    if (!hsnCode || !hsnCode.trim()) {
      return res.status(400).json({ message: 'HSN Code is required' });
    }
    if (!category || !category.trim()) {
      return res.status(400).json({ message: 'Category is required' });
    }

    // Check duplicate in Master Database
    const existing = await HsnMaster.findOne({
      hsnCode: hsnCode.trim(),
      category: category.trim()
    });

    if (existing) {
      return res.status(400).json({ message: `HSN Code "${hsnCode.trim()}" for category "${category.trim()}" already exists in Master Database!` });
    }

    const record = new HsnMaster({
      hsnCode: hsnCode.trim(),
      category: category.trim(),
      productName: (productName || category).trim(),
      gstRate: gstRate !== undefined && gstRate !== '' ? Number(gstRate) : null,
      description: (description || '').trim(),
      keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(',').map(k => k.trim()) : []),
      status: status || 'active',
    });

    const saved = await record.save();
    res.status(201).json(saved);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Duplicate HSN Code and Category combination!' });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update HSN Master record
// @route   PUT /api/hsn/:id
// @access  Private
const updateHsn = async (req, res) => {
  try {
    const { hsnCode, category, productName, gstRate, description, keywords, status } = req.body;
    const record = await HsnMaster.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'HSN Record not found' });
    }

    if (hsnCode !== undefined) record.hsnCode = hsnCode.trim();
    if (category !== undefined) record.category = category.trim();
    if (productName !== undefined) record.productName = productName.trim();
    if (gstRate !== undefined) record.gstRate = gstRate !== '' ? Number(gstRate) : null;
    if (description !== undefined) record.description = description.trim();
    if (keywords !== undefined) {
      record.keywords = Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim());
    }
    if (status !== undefined) record.status = status;

    const updated = await record.save();
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete HSN Master record
// @route   DELETE /api/hsn/:id
// @access  Private
const deleteHsn = async (req, res) => {
  try {
    const record = await HsnMaster.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ message: 'HSN Record not found' });
    }
    await record.deleteOne();
    res.json({ message: 'HSN Record removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  searchHsn,
  autoSuggestHsn,
  getAllHsn,
  createHsn,
  updateHsn,
  deleteHsn,
};
