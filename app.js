const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const dbPath = path.join(__dirname, 'twitterClone.db')
const app = express()
app.use(express.json())

let db = null

const initializeDBAndServer = async () => {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  })
  app.listen(3000, () => {
    console.log('Server is Running at localhost://3000/')
  })
}
initializeDBAndServer()

//API 1
app.post('/register/', async (request, response) => {
  const {username, password, gender, name} = request.body
  const dbUser = await db.get(
    `SELECT * FROM user WHERE username = ${username};`,
  )
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10)
      await db.run(`
                INSERT INTO user 
                    (username, password, gender, name)
                VALUES ('${username}', '${hashedPassword}', '${gender}', '${name}');
            `)
      response.status(200)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//API 2 user login
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const dbUser = await db.get(`
    SELECT * FROM user WHERE username = '${username}';
  `)
  if (dbUser !== undefined) {
    const isPassMatch = await bcrypt.compare(password, dbUser.password)
    if (isPassMatch) {
      let token = jwt.sign(username, 'SECRET_KEY')
      response.send({token})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

function authenticationToken(request, response, next) {
  let token
  const authorization = request.headers['authorization']
  if (authorization !== undefined) {
    token = authorization.split(' ')[1]
  }
  if (token === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(token, 'SECRET_KEY', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload
        next()
      }
    })
  }
}

const tweetResponse = dbObject => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.dateTime,
})

//API 3
app.get(
  '/user/tweets/feed/',
  authenticationToken,
  async (request, response) => {
    const latestTweets = await db.all(`
      SELECT 
        tweet.tweet_id,
        tweet.user_id,
        user.username,
        tweet.tweet,
        tweet.date_time
      FROM
        follower LEFT JOIN tweet ON tweet.user_id = follower.following_user_id
        LEFT JOIN user ON follower.following_user_id = user.user_id
      WHERE 
        follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
      ORDER BY tweet.date_time DESC
      LIMIT 4
    `)
    response.send(latestTweets.map((item) => tweetResponse(item)))
  },
)

//API 4
app.get('/user/following/', authenticationToken, async (request, response) => {
  const following = await db.all(`
        SELECT user.name
        FROM follower LEFT JOIN user ON follower.following_user_id = user.user_id
        WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');
    `)
  response.send(following)
})

//API 5
app.get('/user/followers/', authenticationToken, async (request, response) => {
  const followers = await db.all(`
        SELECT user.name
        FROM follower
        LEFT JOIN user ON follower.follower_user_id = user.user_id
        WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');
    `)
  response.send(followers)
})

const follows = async (request, response, next) => {
  const {tweetId} = request.params
  let isFollowing = await db.get(`
        SELECT * 
        FROM follower
        WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
        AND 
        following_user_id = (SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id = '${tweetId}');
    `)
  if (isFollowing === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//API 6
app.get(
  '/tweets/:tweetId/',
  authenticationToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const {tweet, date_time} = await db.get(`
        SELECT tweet, date_time FROM tweet WHERE tweet_id = ${tweetId};
    `)
    const {likes} = await db.get(`
        SELECT count(like_id) AS likes FROM like WHERE tweet_id = ${tweetId};
    `)
    const {replies} = await db.get(`
        SELECT count(reply_id) AS replies FROM reply WHERE tweet_id = ${tweetId}; 
    `)
    response.send({tweet, likes, replies, dateTime: date_time})
  },
)

//API 7
app.get(
  '/tweets/:tweetId/likes/',
  authenticationToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const likeBy = await db.all(`
        SELECT user.username FROM like NATURAL JOIN user
        WHERE tweet_id = ${tweetId};
    `)
    response.send({likes: likeBy.map((item) => item.username)})
  },
)

//API 8
app.get(
  '/tweets/:tweetId/replies/',
  authenticationToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const replies = await db.all(`
        SELECT user.name, reply.reply 
        FROM reply NATURAL JOIN user 
        WHERE tweet_id = ${tweetId};
    `)
    response.send({replies})
  },
)

//API 9
app.get('/user/tweets/', authenticationToken, async (request, response) => {
  const myTweets = await db.all(`
        SELECT 
          tweet.tweet,
          count(DISTINCT like.like_id) AS likes,
          count(DISTINCT reply.reply_id) AS replies,
          tweet.date_time
        FROM tweet 
          LEFT JOIN like ON tweet.tweet_id = like.tweet_id
          LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
        GROUP BY tweet.tweet_id;
    `)
  response.send(
    myTweets.map((item) => {
      const {date_time, ...rest} = item
      return {...rest, dateTime: date_time}
    }),
  )
})

//API 10
app.post('/user/tweets/', authenticationToken, async (request, response) => {
  const {tweet} = request.body
  const {user_id} = await db.get(`
        SELECT user_id FROM user WHERE username = '${request.username}';
    `)
  await db.run(`
        INSERT INTO tweet(tweet, user_id)
        VALUES ('${tweet}', ${user_id});
    `)
  response.send('Created a Tweet')
})

//API 11
app.delete(
  '/tweets/:tweetId/',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request.params
    const userTweet = await db.get(`
        SELECT tweet_id, user_id
        FROM tweet 
        WHERE tweet_id = ${tweetId}
        AND user_id (SELECT user_id FROM user WHERE username = '${request.username}');
    `)
    if (userTweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      await db.run(`
          DELETE FROM tweet 
          WHERE tweet_id = ${tweetId};
      `)
      response.send('Tweet Removed')
    }
  },
)
module.exports = app

