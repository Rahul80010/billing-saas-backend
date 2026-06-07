const Customer = require('../models/Customer');

// @desc    Get all customers
// @route   GET /api/customers
// @access  Private
const getCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({ userId: req.user._id });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a customer
// @route   POST /api/customers
// @access  Private
const createCustomer = async (req, res) => {
  const { name, phone } = req.body;

  try {
    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone are required' });
    }

    const cleanPhone = phone.trim();
    const cleanName = name.trim();

    // Check if customer with same phone already exists for this merchant user
    let customer = await Customer.findOne({ userId: req.user._id, phone: cleanPhone });

    if (customer) {
      // If it exists, update the name if it is different, and return the existing record
      if (customer.name !== cleanName) {
        customer.name = cleanName;
        await customer.save();
      }
      return res.status(200).json(customer);
    }

    // Otherwise, create a new customer
    customer = new Customer({
      userId: req.user._id,
      name: cleanName,
      phone: cleanPhone,
    });

    const createdCustomer = await customer.save();
    res.status(201).json(createdCustomer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a customer
// @route   PUT /api/customers/:id
// @access  Private
const updateCustomer = async (req, res) => {
  const { name, phone } = req.body;

  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    const customer = await Customer.findOne({ _id: req.params.id, userId: req.user._id });

    if (customer) {
      customer.name = name !== undefined ? name : customer.name;
      customer.phone = phone !== undefined ? phone : customer.phone;

      const updatedCustomer = await customer.save();
      res.json(updatedCustomer);
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a customer
// @route   DELETE /api/customers/:id
// @access  Private
const deleteCustomer = async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    const customer = await Customer.findOne({ _id: req.params.id, userId: req.user._id });

    if (customer) {
      await customer.deleteOne();
      res.json({ message: 'Customer removed' });
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get customer by ID
// @route   GET /api/customers/:id
// @access  Private
const getCustomerById = async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    const customer = await Customer.findOne({ _id: req.params.id, userId: req.user._id });

    if (customer) {
      res.json(customer);
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerById,
};
