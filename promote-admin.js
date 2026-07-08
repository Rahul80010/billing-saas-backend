const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from backend .env
dotenv.config();

const User = require('./models/User');

const dbUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/billing-saas';

async function run() {
  console.log('Connecting to database:', dbUri);
  await mongoose.connect(dbUri);
  console.log('Connected!');

  const users = await User.find({}, 'name email isAdmin');
  console.log('\nAll Users in Database:');
  console.log('----------------------------------------------------');
  users.forEach((u, i) => {
    console.log(`${i + 1}. Name: ${u.name} | Email: ${u.email} | Admin: ${u.isAdmin}`);
  });
  console.log('----------------------------------------------------');

  const emailToPromote = process.argv[2];
  if (!emailToPromote) {
    console.log('\nUsage: node promote-admin.js <email>');
    console.log('Example: node promote-admin.js rrssacsbusiness3@gmail.com');
    mongoose.connection.close();
    return;
  }

  const user = await User.findOne({ email: emailToPromote.trim().toLowerCase() });
  if (!user) {
    console.log(`\nUser with email "${emailToPromote}" not found.`);
    mongoose.connection.close();
    return;
  }

  user.isAdmin = !user.isAdmin;
  await user.save();
  console.log(`\nSuccess! User "${user.email}" isAdmin is now set to: ${user.isAdmin}`);
  mongoose.connection.close();
}

run().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
