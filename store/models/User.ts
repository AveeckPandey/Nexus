import { Schema, model, models } from 'mongoose';

const UserSchema = new Schema({
  username: { 
    type: String, 
    required: [true, 'Username is required'],
    unique: true 
  },
  email: { 
    type: String, 
    required: [true, 'Email is required'],
    unique: true 
  },
  password: { 
    type: String, 
    required: [true, 'Password is required'] 
  },
  image: { type: String, default: '' },
}, { timestamps: true });

// This "models.User ||" check prevents re-defining the model on every reload
const User = models.User || model('User', UserSchema);

export default User;
