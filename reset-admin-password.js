const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('./models/User');

const dbUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/billing-saas';

async function run() {
  console.log('Connecting to database:', dbUri);
  await mongoose.connect(dbUri);
  console.log('Connected!');

  const email = 'detalogy@gmail.com';
  const newPassword = 'adminpassword123';

  const user = await User.findOne({ email });
  if (!user) {
    console.log(`User with email "${email}" not found.`);
    mongoose.connection.close();
    return;
  }

  user.password = newPassword;
  await user.save();
  console.log(`\nSuccess! Password for "${email}" has been set to: ${newPassword}`);
  mongoose.connection.close();
}

run().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
