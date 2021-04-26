const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GroupSchema = new Schema({
    groupName: { type: String, required: true},
    entryCode: String,
    description: String,
    owner: {type: Schema.Types.ObjectId, ref: 'User', required: true},
    lessons:[{ type: Schema.Types.ObjectId, ref: 'Lesson' }],
    students: [{type: Schema.Types.ObjectId, ref: 'User'}]
});

module.exports = mongoose.model('Group', GroupSchema);