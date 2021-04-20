const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();
const session = require('express-session');
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const User = require('./models/user');
const Group = require('./models/group');
const Lesson = require('./models/lesson');
const Message = require('./models/message');
const users = require('./users');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const methodOverride = require('method-override');
const { isLoggedIn } = require('./middleware');


const roomsData = {};

//express setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(__dirname+"/public"));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));

const sessionConfig = {
    secret: 'dngdngmvmvcbmfgwgfejhfkjghkfghjkrsywrgreykiyt',
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}

app.use(session(sessionConfig))

app.use(passport.initialize());
app.use(passport.session());


passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    next();
})

//połączenie do bazy danych
mongoose.connect('mongodb://localhost:27017/inzynieria-projekt', {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true
});

//połączenie do bazy i ustanowienie połączenia
const db = mongoose.connection;
db.on("error", console.error.bind(console, 'connection error:'));
db.once("open", ()=>{
    console.log("Database connected");
})


// socket connection
io.on('connection', (socket) => {
    console.log("user connected");

    socket.on('disconnect', () => {
        console.log("disconnect");
    });

    socket.on('disconnecting', ()=>{
        let vievID, editID;
        if(roomsData[socket.roomId] && roomsData[socket.roomId].viewers){
            vievID = roomsData[socket.roomId].viewers.includes(socket.id) ? roomsData[socket.roomId].viewers.indexOf(socket.id) : undefined;
            if(vievID)
                roomsData[socket.roomId].viewers.splice(vievID, 1);
        }
        if(roomsData[socket.roomId] && roomsData[socket.roomId].editors){
            editID = roomsData[socket.roomId].editors.includes(socket.id) ? roomsData[socket.roomId].editors.indexOf(socket.id) : undefined;
            if(editID)
                roomsData[socket.roomId].editors.splice(editID, 1);
        } 
    })

    socket.on('joinBoardGroup', (roomId, name, lastName, userId)=>{
        socket.join(roomId);
        socket.room = roomId;
        socket.name = name;
        socket.lastName = lastName;
        socket.userId = userId;
        if(roomsData[roomId]){
            roomsData[roomId].viewers.push(socket.id);
            socket.emit('joinedViewres');
            socket.emit('sendCanvasToViewers', roomsData[roomId].canvasDataJson ? roomsData[roomId].canvasDataJson : '');
        }else{
            roomsData[roomId] = {};
            roomsData[roomId].editors = [];
            roomsData[roomId].viewers = [];
            roomsData[roomId].editors.push(socket.id);
            Lesson.findOne({_id: socket.room}, function(err, lesson){
                if(err)
                    console.log(err)
                roomsData[roomId].canvasDataJson = lesson.camvasContent;
                socket.emit('sendCanvasToEditors', lesson.canvasContent);
            })
            socket.emit('joinedEditors');
        }
    })

    socket.on('sendMessage', (payload)=>{
        socket.to(socket.room).emit('sendMessage', payload, socket.name, socket.lastName);
        socket.emit('sendMessage', payload, socket.name, socket.lastName);
        
        Lesson.findOne({_id: socket.room}, function(err, lesson){
            if(err)
                console.log(err);
            const message = new Message({content: payload, ownerId: socket.userId});
            lesson.messages.push(message);
            lesson.save();
            message.save();
        });
        
    })

    socket.on('sendCanvas', (canvasDataURI)=>{
        roomsData[socket.room].canvasDataJson = canvasDataURI;
        let editors = roomsData[socket.room].editors;
        for(let i = 0; i < editors.length; i++){
            if(editors[i] !== socket.id)
                io.to(editors[i]).emit('sendCanvasToEditors', canvasDataURI);
        }

        let viewer = roomsData[socket.room].viewers;
        for(let i = 0; i < viewer.length; i++){
            io.to(viewer[i]).emit('sendCanvasToViewers', canvasDataURI);
        }

        Lesson.updateOne({_id: socket.room}, {canvasContent: canvasDataURI}, function(err, doc){
            if(err)
                console.log(err);
        })
    })
});


// routes
app.get('/', (req,res)=>{
    res.render("mainPage");
})

app.get('/login', (req, res)=>{
	res.render("login");
})

app.post('/login', passport.authenticate('local', {failureRedirect: '/login'}), (req, res)=>{
    res.redirect(req.session.returnTo ? req.session.returnTo : '/login');
})

app.get('/register', (req, res)=>{
	 res.render("register");
})

app.post('/register', async(req, res)=>{
    try{
        const {name, lastName, username, password} = req.body;
        const user = new User({ name, lastName, username});
        const regUser = await User.register(user, password);
        req.login(regUser, err=>{
            if(err)
                res.redirect('/register')
            else
                res.redirect('/user/'+regUser._id);
        });
    }catch (e){
        console.log(e);
        res.redirect('/register');
    }
})

app.get('/logout', (req,res)=>{
    req.logOut();
    res.redirect('/');
})

app.get('/user/:id', isLoggedIn, async(req, res)=>{
    const user = await User.findOne({_id: req.user._id}).populate('groups');
    const ownedGroups = await Group.find({owner: req.user._id}).populate('students').populate('lessons');
    res.render('user', {user, ownedGroups})
})

app.get('/group/add', isLoggedIn, (req,res)=>{
    res.render('newGroup');
})

app.post('/group/add', isLoggedIn, async(req,res)=>{
    try{
        const {groupName, description} = req.body;
        const entryCode = ~~(Math.random()*10000000000);

        const newGroup = new Group({ groupName, description, entryCode, owner: req.user._id})

        const group = await newGroup.save();
        res.redirect('/group/'+group._id);
    }
    catch(e){
        console.log(e);
        res.redirect('/group/add');
    }
})

app.get('/group/:id/lesson/add', isLoggedIn, (req,res)=>{
    res.render('newLesson', {groupId: req.params.id});
})

app.post('/group/:id/lesson/add', isLoggedIn, async(req, res)=>{
    try{
        const { topic } = req.body;
        const newLesson = new Lesson({
            topic
        })
        newLesson.save();
        const group = await Group.findOne({_id: req.params.id});
        group.lessons.push(newLesson);
        const updatedGroup = await group.save();
        res.redirect('/group/'+req.params.id);
    }catch (e){
        console.log(e)
        res.redirect('/group/'+req.params.id);
    }
})

app.get('/group/:id', isLoggedIn, async(req, res)=>{
	try{
        let dummyUsers = [];
        for(let i = 0; i < 15; i ++){
            dummyUsers.push(users[Math.floor(Math.random()*users.length)]);
        }
        const group = await Group.findOne({_id: req.params.id}).populate('lessons');
        res.render('group', {groupData: group, users: dummyUsers})
    }catch(e){
        console.log(e);
        res.redirect('/');
    }
})

app.delete('/group/:id/delete', isLoggedIn, (req, res)=>{
    res.send('strona do usuwania usera z grupy')
})

app.post('/user/:id/joinGroup', isLoggedIn, async(req, res)=>{
    try{
        const {entryCode} = req.body;
        const group = await Group.findOne({entryCode: entryCode});
        const student = await User.findOne({_id: req.user._id});
        group.students.push(student);
        group.save();
        student.groups.push(group);
        student.save();
        res.redirect('/user/'+req.user._id);
    }catch(e){
        console.log(e);
        res.redirect('/user/'+req.user._id);
    }
})

app.get('/group/:id/lesson/:lessonId', isLoggedIn, (req, res)=>{
    let dummyUsers = [];
    
    for(let i = 0; i < 15; i ++){
        dummyUsers.push(users[Math.floor(Math.random()*users.length)]);
    }
	res.render('board', {groupId: req.params.lessonId, users: dummyUsers})
})

http.listen(3000, ()=>{
    console.log("app runs on port 3000");
})