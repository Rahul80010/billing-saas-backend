const mongoose = require('mongoose');

async function testDB() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect('mongodb+srv://Rahul123:Rahul12345@billing.o4lpmyw.mongodb.net/billing-saas?retryWrites=true&w=majority&appName=Billing', {
      serverSelectionTimeoutMS: 5000
    });
    console.log('Connected!');
    
    // Define a basic User model if not already compiled
    const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    
    const users = await User.find({}).lean();
    console.log('Users in DB:');
    console.log(users.map(u => ({ email: u.email, isVerified: u.isVerified, hasPassword: !!u.password })));
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

testDB();
