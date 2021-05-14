const { Schema, model } = require('mongoose')

const TrackingSchema = new Schema({
    pincode: { type: Number },
    age_group: { type: Number }
}, {
    id: true,
})

const UserSchema = new Schema({ 
    chatId: { type: Number, required: true },
    allowed: { type: Boolean, default: false },
    mobile: { type: String },
    lastOtpRequested: { type: Number },
    snoozeTime: { type: Number },
    snoozedAt: { type: Number },
    txnId: { type: String },
    token: { type: String },
    stateId: { type: Number },
    districtId: { type: Number },
    tmpPincode: { type: Number },
    tmp_age_group: { type: Number },
    tracking: [{ type: TrackingSchema, default: [] }],
    beneficiaries: { type: Array, default: [] }
})

const User = model('User', UserSchema, 'users')

module.exports = User