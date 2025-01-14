'use strict';
require('dotenv')
const { Telegraf, Scenes, session, TelegramError } = require('telegraf')
const { CoWIN, em } = require('./wrapper')
const mongoose = require('mongoose')
const User = require('./model')
const fs = require('fs')
const Token = require('./token')
const cron = require('node-cron')
const { spawnSync } = require('child_process')
const { Location } = require('./locationModel')
const moment = require('moment-timezone')

mongoose.connect('mongodb://localhost:27017/Cowin', { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true })
.then(() => console.log('Connected to Database!'))
.catch((err) => console.log(err))

const BOT_TOKEN = process.env.BOT_TOKEN
const bot = new Telegraf(BOT_TOKEN)
const SWAPNIL = parseInt(process.env.OWNER_TG_ID)
const MAX_OTP_PER_DAY = 50

// ========CRON=========
cron.schedule('2 0 * * *', async () => {
    await bot.telegram.sendMessage(SWAPNIL, 'Cron Task: Resetting OTP Counts and Flushing pm2 logs!')
    await User.updateMany({ allowed: true }, { $set: { otpCount: 0 } })
    spawnSync('pm2', ['flush'])
    spawnSync('mongoexport', ['-d', 'Cowin', '-c', 'users', '--jsonArray', '-o', 'cowin_users.json'])
    await bot.telegram.sendDocument(SWAPNIL, { source: fs.createReadStream('cowin_users.json'), filename: 'cowin_users.json' })
    fs.unlinkSync('cowin_users.json')
    fs.unlinkSync('states.json')
    await Location.deleteMany({})
    await bot.telegram.sendMessage(SWAPNIL, 'Deleted states.json and cleared Districts db!')
}, { timezone: 'Asia/Kolkata', scheduled: true })

// =====================


/**
 * Helper methods
 */
function getDoseCount(beneficiary) {
    if(beneficiary.dose1_date) {
        return 2
    }
    return 1
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function checkCenterToBook(uCenter, userCenters) {
    if (!userCenters.length) {
        return true
    }
    return !!userCenters.includes(uCenter.center_id)
}

function generateMessages(userCenters, userdata) {
    const alerts = userCenters.map(uCenter => `✅<b>SLOT AVAILABLE!</b>\n\n<b>Name</b>: ${uCenter.name}\n<b>Pincode</b>: ${uCenter.pincode}\n<b>Age group</b>: ${userdata.age_group}+\n<b>Fee</b>: ${uCenter.fee_type}\n<b>Slots</b>:\n\t${uCenter.sessions.map(s => `<b>Date</b>: ${s.date}\n\t<b>Total Available Slots</b>: ${s.available_capacity}\n\t\t<b>Dose 1 Slots</b>: ${s.available_capacity_dose1}\n\t\t<b>Dose 2 Slots</b>: ${s.available_capacity_dose2}${s.vaccine ? '\n\t<b>Vaccine</b>: ' + s.vaccine : ''}${s?.allow_all_age ? `\n<b><u>Walk-in Available for all Age Groups!</u></b>` : ''}`).join('\n')}\n\n<u>Hurry! Book your slot before someone else does.</u>\nCoWIN Site: https://selfregistration.cowin.gov.in/`)
    let chunkSize = 0
    const MAX_MSG_SIZE = 4096 - 50 // 50bytes padding for safer side
    const messages = []
    let msg = ''
    for (const alert of alerts) {
        chunkSize += alert.length
        if (chunkSize < MAX_MSG_SIZE) {
            msg += alert + '\n\n'
        } else {
            messages.push(msg)
            msg = ''
            msg += alert + '\n\n'
            chunkSize = 0
            chunkSize += alert.length
        }
    }
    messages.push(msg)
    return messages
}

function calculateSleeptime() {
    const proxies = fs.readFileSync('proxies.txt').toString().split('\n').filter(line => !!line).map(line => ({ host: line.split(':')[0], port: line.split(':')[1] }))
    const ipCount = proxies.length
    if (ipCount == 0) {
        return 180
    }
    // deprecated: No proxy usage from now on
    const fivMins = 5*60*1000
    const reqPerIp = 100
    const perIpTime = fivMins/ipCount
    const sleeptime = parseInt((perIpTime/reqPerIp) + 25)
    console.log('SLEEPTIME:', sleeptime)
    return sleeptime
}

var TRACKER_SLEEP_TIME = calculateSleeptime() // for x ips
const MAX_TRACKING_ALLOWED = 4
const SNOOZE_LITERALS = [
    { name: '10min', seconds: 10 * 60 },
    { name: '20min', seconds: 20 * 60 },
    { name: '45min', seconds: 45 * 60 },
    { name: '1hr', seconds: 1 * 60 * 60 },
    { name: '2hr', seconds: 2 * 60 * 60 },
    { name: '4hr', seconds: 4 * 60 * 60 },
    { name: '6hr', seconds: 6 * 60 * 60 },
    { name: '8hr', seconds: 8 * 60 * 60 },
    { name: '10hr', seconds: 10 * 60 * 60 },
    { name: '12hr', seconds: 12 * 60 * 60 },
    { name: '18hr', seconds: 18 * 60 * 60 }
]

/**
 * @deprecated no thumbs usage
 */
const THUMBS = {
    up: ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'],
    down: ['👎', '👎🏻', '👎🏼', '👎🏽', '👎🏾', '👎🏿']
}

const _isAuth = async (chatId) => {
    const { token } = await User.findOne({ chatId })
    return Token.isValid(token)
}

const _isInvited = async (chatId) => {
    const allowed = await User.findOne({ chatId, allowed: true })
    return !!allowed
}

function secondsToHms(d) {
    d = Number(d);
    let h = Math.floor(d / 3600);
    let m = Math.floor(d % 3600 / 60);
    let s = Math.floor(d % 3600 % 60);

    let hDisplay = h > 0 ? h + (h == 1 ? " hour, " : " hours, ") : "";
    let mDisplay = m > 0 ? m + (m == 1 ? " minute, " : " minutes, ") : "";
    let sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";
    return hDisplay + mDisplay + sDisplay;
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), ms)
    })
}

function getFutureDate(appointment) {
    const appointmentDate = moment(appointment.date, 'DD-MM-YYYY').tz('Asia/Kolkata')
    const today = moment(moment().tz('Asia/Kolkata').format('DD-MM-YYYY'), 'DD-MM-YYYY')
    return today <= appointmentDate
}

function checkValidVaccine(center, preferredBenef) {
    if (!preferredBenef.vaccine) {
        return true
    }
    const valid = !!center.sessions.find(s => s.vaccine == preferredBenef.vaccine)
    return valid
}

function switchChoose (preferredBenef) {
    if(!preferredBenef.appointments.length) {
        return 'schedule'
    }
    const hasFuture = !!preferredBenef.appointments.find(getFutureDate)
    if (hasFuture) {
        return 'reschedule'
    } else {
        return 'schedule'
    }
}

function getFutureAppointment(appointments) {
    const appointment = appointments.find(getFutureDate)
    return appointment.appointment_id
}


/**
 * Middlewares
 */

const authMiddle = async (ctx, next) => {
    if (await _isAuth(ctx.chat.id)) {
        next()
    } else {
        try {
            return await ctx.reply('Sorry! You\'re not logged in! Please /login first.')
        } catch (err) {
            if (err instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
            }
        }
    }
}

const switchMiddle = async (ctx, next) => {
    const { autobook } = await User.findOne({ chatId: ctx.chat.id, allowed: true })
    if (autobook == true) {
        return next()
    } else {
        return authMiddle(ctx, next)
    }
}

const pinCheckMiddle = async (ctx, next) => {
    const { tracking } = await User.findOne({ chatId: ctx.chat.id })
    if (Array.isArray(tracking) && tracking.length > 0) {
        next()
    } else {
        return await ctx.reply('You aren\'t tracking any pincode. Please /track atleast one pincode to activate /autobook')
    }
}

const inviteMiddle = async (ctx, next) => {
    if(await _isInvited(ctx.chat.id)) {
        next()
    } else {
        try {
            return await ctx.reply('Please verify yourself by providing invite code!\nSend /start to invite yourself.')
        } catch (err) {
            if (err instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
            }
        }
    }
}

const groupDetection = async (ctx, next) => {
    try {
        if(String(ctx.chat.id).startsWith('-')) {
            await ctx.reply('This bot is not operatable in groups!')
            return await ctx.leaveChat()
        }
        next()
    } catch (err) { }
}

const benefMiddle = async (ctx, next) => {
    try {
        const { beneficiaries, preferredBenef } = await User.findOne({ chatId: ctx.chat.id })
        if (Array.isArray(beneficiaries) && beneficiaries.length) {
            if (preferredBenef && (Object.keys(preferredBenef)).length !== 0) {
                return next()
            }
            return await ctx.reply('Please choose preferred beneficiary for auto slot booking. Send /beneficiaries to choose.')
        }

        return await ctx.reply('Please search for /beneficiaries and choose your preferred one.')
    } catch (error) {}
}

const botUnderMaintain = async (ctx, next) => {
    if (ctx.chat.id == SWAPNIL) {
        return next()
    }
    try {
        return await ctx.reply('Bot is under maintenance. Please try again after few minutes.')
    } catch (err) { }
}

/**
 * Wizards
 */

const walkthrough = new Scenes.WizardScene(
    'walkthrough',
    async (ctx) => {
        await ctx.reply('Welcome to the bot! Let\'s get started with a simple walkthrough :)\nFirstly login using the bot.')
        return ctx.scene.enter('login')
    }
)

const loginWizard = new Scenes.WizardScene(
    'login',
    async (ctx) => {
        try {
            const { mobile } = await User.findOne({ chatId: ctx.chat.id }).select('mobile')
            let options = {}
            if (mobile) {
                options = {
                    reply_markup: {
                        keyboard: [
                            [{ text: mobile }]
                        ],
                        remove_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            }
            await ctx.reply('Send your phone number (10 digits only)', options)
            return ctx.wizard.next()
        } catch (error) {
            if (error instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
                return ctx.scene.leave()
            }
            console.log(error)
            try {
                await ctx.reply('Some error occured please retry!')
            } catch (err) { }
            return ctx.scene.leave()
        }
    },
    async (ctx) => {
        try {
            const mobile = ctx.message.text.trim()
            ctx.wizard.state.mobile = mobile
            if (mobile.length != 10) {
                await ctx.reply('Please send 10 digit mobile number!', { reply_markup: { remove_keyboard: true } })
                return ctx.scene.reenter()
            }
            const isnum = /^\d+$/.test(mobile)
            if (!isnum) {
                await ctx.reply('Please provide numbers only!')
                return ctx.scene.reenter()
            }
            try {
                const cowin = new CoWIN(mobile)
                ctx.wizard.state.cowin = cowin
                const MAX_TIMEOUT_OTP = 180 //sec
                const currentTime = parseInt(Date.now() / 1000)
                const { lastOtpRequested } = await User.findOneAndUpdate({ chatId: ctx.chat.id }, { $set: { mobile } })
                if (currentTime - lastOtpRequested < MAX_TIMEOUT_OTP) {
                    await ctx.reply(`Please wait ${Math.abs(currentTime - (lastOtpRequested + MAX_TIMEOUT_OTP))} seconds before requesting for new otp.`)
                    return await ctx.scene.leave()
                }

                // const hour = moment().tz('Asia/Kolkata').get('hour')
                // if (hour >= 16 && hour <= 20) {
                //     await ctx.reply('Instead bot, You can now login from the bot\'s site. Click on the button below to login. Once you finish the process check back here on bot. :)', {
                //         reply_markup: {
                //             inline_keyboard: [
                //                 [{ text: 'Login!', url: `http://20.193.247.116/login?mobile=${mobile}&chatId=${ctx.chat.id}` }]
                //             ]
                //         }
                //     })
                //     return ctx.scene.leave()
                // } else {
                await ctx.wizard.state.cowin.sendOtp()
                await User.updateOne({ chatId: ctx.chat.id }, {
                    $set: {
                        lastOtpRequested: parseInt(Date.now()/1000),
                        txnId: ctx.wizard.state.cowin.txnId
                    },
                    $inc: { otpCount: 1 }
                })
                // }
            } catch (err) {
                if (err instanceof TelegramError) {
                    await User.deleteOne({ chatId: ctx.chat.id })
                    return ctx.scene.leave()
                }
                console.log(err)
                await ctx.reply('Error while sending OTP!\nPlease try again after some time!')
                await ctx.reply('Instead bot, You can now login from the bot\'s site. Click on the button below to login. Once you finish the process check back here on bot. :)', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Login!', url: `http://20.193.247.116/login?mobile=${mobile}&chatId=${ctx.chat.id}` }]
                        ]
                    }
                })
                return ctx.scene.leave()
            }
            const { otpCount, walkthrough } = await User.findOne({ chatId: ctx.chat.id }).select('otpCount walkthrough')
            if (!walkthrough) {
                await ctx.reply(`You\'ve requested OTP for ${otpCount} time${otpCount > 1 ? 's': ''} today. You can check your otp counts by sending /status`)
            }
            await ctx.reply('Send your OTP')
            return ctx.wizard.next()
        } catch (error) {
            if (error instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
                return ctx.scene.leave()
            }
            console.log(error)
            try {
                await ctx.reply('Some error occured please retry!')
            } catch (err) {}
            return ctx.scene.leave()
        }
    },
    async (ctx) => {
        try {
            const otp = ctx.message.text.trim()
            const isnum = /^\d+$/.test(otp)
            if (!isnum) {
                await ctx.reply('Please provide numbers only!')
                return
            }
            try {
                await ctx.wizard.state.cowin.verifyOtp(otp)
                await User.updateOne({ chatId: ctx.chat.id }, { $set: { token: ctx.wizard.state.cowin.token } })
                await ctx.reply('Login successful!')
                await User.updateOne({ chatId: ctx.chat.id }, { $set: { mobile: ctx.wizard.state.mobile, expireCount: 0 } })
                const { walkthrough } = await User.findOne({ chatId: ctx.chat.id })
                if (!walkthrough) {
                    await ctx.reply('Send /help to know further commands.')
                } else {
                    await ctx.reply('Alright! Now choose your beneficiary for whom you want to book.')
                    beneficiaryCommand(ctx)
                }
                return ctx.scene.leave()
            } catch (err) {
                if (err instanceof TelegramError) {
                    await User.deleteOne({ chatId: ctx.chat.id })
                    return ctx.scene.leave()
                }
                console.log(err)
                await ctx.reply('Invalid OTP!\nYou can try again with /otp <your-OTP>')
                return ctx.scene.leave()
            }
        } catch (error) {
            if (error instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
                return ctx.scene.leave()
            }
            console.log(error)
            try {
                await ctx.reply('Some error occured please retry!')
            } catch (err) { }
            return ctx.scene.leave()
        }
    }
)

loginWizard.command('cancel', async (ctx) => {
    await ctx.scene.leave()
    return await ctx.reply('Operation cancelled!')
})

const slotWizard = new Scenes.WizardScene(
    'slot-booking',
    async (ctx) => {
        try {
            await ctx.reply('Send your pincode')
            return ctx.wizard.next()
        } catch (error) {
            console.log(error)
            try {
                await ctx.reply('Some error occured please retry!')
            } catch (err) { }
            return ctx.scene.leave()
        }
    },
    async (ctx) => {
        try {
            const pincode = ctx.message.text.trim()
            if (pincode.length !== 6) {
                await ctx.reply('Please provide valid pincode!')
                return ctx.scene.reenter()
            }
            const isnum = /^\d+$/.test(pincode)
            if (!isnum) {
                await ctx.reply('Please provide numbers only!')
                return ctx.scene.reenter()
            }
            ctx.wizard.state.pincode = pincode
            await User.updateOne({ chatId: ctx.chat.id }, { $set: { tmpPincode: pincode } })
            await ctx.reply('Please choose age group.', { reply_markup:
                {
                    inline_keyboard:[
                        [ { text: '18+', callback_data: '18_plus' }, { text: '45+', callback_data: '45_plus' } ]
                    ]
                }
            })

            return ctx.scene.leave()
        } catch(err) {
            if (err instanceof TelegramError && err.response.status == 401) {
                await ctx.reply('No slots available for this pin!')
                return ctx.scene.leave()
            }
            console.log(err)
            try {
                await ctx.reply('Some error occured please retry!')
            } catch (err) { }
            return ctx.scene.leave()
        }
    }
)

slotWizard.command('cancel', async (ctx) => {
    await ctx.scene.leave()
    return await ctx.reply('Operation cancelled!')
})

bot.action('18_plus', async (ctx) => {
    try {
        const chatId = ctx.update.callback_query.from.id
        await User.updateOne({ chatId }, { $set: { tmp_age_group: 18 } })
        return await ctx.editMessageText('Please choose specific dose you want to track.', { reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Dose 1', callback_data: `dose-selection--${1}` },
                    { text: 'Dose 2', callback_data: `dose-selection--${2}` },
                    { text: 'Any Dose', callback_data: `dose-selection--${0}` }
                ]
            ]
        } })
    } catch (err) {
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
        }
    }
    // return ctx.scene.enter('track-pt2')
})

bot.action('45_plus', async (ctx) => {
    try {
        const chatId = ctx.update.callback_query.from.id
        await User.updateOne({ chatId }, { $set: { tmp_age_group: 45 } })
        return await ctx.editMessageText('Please choose specific dose you want to track.', { reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Dose 1', callback_data: `dose-selection--${1}` },
                    { text: 'Dose 2', callback_data: `dose-selection--${2}` },
                    { text: 'Any Dose', callback_data: `dose-selection--${0}` }
                ]
            ]
        } })
    } catch (err) {
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return ctx.scene.leave()
        }
    }
    // return ctx.scene.enter('track-pt2')
})

bot.action(/dose-selection--.*/, async (ctx) => {
    try {
        const chatId = ctx.update.callback_query.from.id
        const dose = parseInt(ctx.update.callback_query.data.split('dose-selection--')[1])
        await User.updateOne({ chatId }, { $set: { tmpDose: dose } })
        // return await ctx.editMessageText(`Selected ${dose ? 'Dose ' + dose : 'Any Dose'}\nSend any text to continue...`)
        const { tmpPincode, tmp_age_group } = await User.findOne({ chatId: ctx.chat.id })
        const userTracking = await User.findOne({ chatId: ctx.chat.id, tracking: { $elemMatch: { pincode: tmpPincode, age_group: tmp_age_group } } }).select('tracking')
        if (userTracking) {
            return await ctx.editMessageText('You are already tracking this pincode and age group!')
        }
        return await ctx.editMessageText(`Your provided Information.\n<b>Pincode</b>: ${tmpPincode}\n<b>Age group</b>: ${tmp_age_group}+\n<b>Dose</b>: ${dose === 0 ? 'ANY' : dose}\nIf it is correct then send 👍 else 👎`, { parse_mode: 'HTML', reply_markup: {
            inline_keyboard: [
                [{ text: '👍', callback_data: `selection-accept` }, { text: '👎', callback_data: `selection-reject` }]
            ]
        } })
    } catch (err) {
        console.log(err)
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
    }
})

bot.action('selection-accept', async (ctx) => {
    try {
        const txt = ctx.update.callback_query.message.text
        const entities = ctx.update.callback_query.message.entities
        await ctx.editMessageText(txt + '\n\nRequest accepted!', { entities })
        const { tmpPincode, tmp_age_group, tmpDose, walkthrough } = await User.findOne({ chatId: ctx.chat.id })
        await User.updateOne({ chatId: ctx.chat.id }, { $push:
            {
                tracking: { pincode: tmpPincode, age_group: tmp_age_group, dose: tmpDose }
            }
        })
        await User.updateOne({ chatId: ctx.chat.id }, { $unset: { tmpPincode: 1, tmp_age_group: 1, tmpDose: 1 } })
        await ctx.reply('Now, You\'ll be notified as soon as the vaccine will be available in your desired pincode. Please take a note that this bot is in experimental mode. You may or may not receive messages. So please check the portal by yourself as well. Also if you find some issues then please let me know @SoniSins')
        await ctx.reply(`You can track multiple pins. Max tracking pin limit is ${MAX_TRACKING_ALLOWED}\nYou can choose your preferred vaccine and fee type by sending /vaccine\nAlso you can choose your desired center for autobooking using /center`)
        if (walkthrough) {
            await ctx.reply('Awesome! Now we\'re all set up! Now you can Turn ON <b>Autobook</b> Feature. :)\nJust select \"Turn ON\" button from next Message.', { parse_mode: 'HTML' })
            autoBookCommand(ctx)
        }
    } catch (error) {
        console.log(error)
    }
})

bot.action('selection-reject', async (ctx) => {
    try {
        const txt = ctx.update.callback_query.message.text
        const entities = ctx.update.callback_query.message.entities
        return ctx.editMessageText(txt + '\nRequest Rejected!', { entities })
    } catch (error) {
        console.log(error)
    }
})

const sendToAll = new Scenes.WizardScene(
    'send-all',
    async (ctx) => {
        await ctx.reply('Send the message which you want to convey to all.')
        return ctx.wizard.next()
    },
    async (ctx) => {
        const msg = ctx.message.text
        const entities = ctx.message.entities
        ctx.wizard.state.msg = msg
        ctx.wizard.state.entities = entities
        await ctx.reply(`Start from?`)
        return ctx.wizard.next()
    },
    async (ctx) => {
        try {
            const startfrom = parseInt(ctx.message.text.trim()) || 0
            ctx.scene.leave()
            const { msg, entities } = ctx.wizard.state
            const users = (await User.find({})).filter(u => u.allowed && u.chatId)
            await ctx.reply(`Broadcasting the message to ${users.length} people.`)
            const mesg = await ctx.reply('Status...')

            await ctx.scene.leave()
            let counter = 0
            for (const user of users) {
                if (counter < startfrom) {
                    counter += 1
                    continue
                }
                try {
                    if (user.allowed) {
                        const announcement = await bot.telegram.sendMessage(user.chatId, msg, { entities })
                        await bot.telegram.pinChatMessage(user.chatId, announcement.message_id)
                        await sleep(200)
                    }
                } catch (err) {
                    console.log("Broadcast error!", err)
                    if (err instanceof TelegramError) {
                        if (err.response.error_code == 403) {
                            await User.deleteOne({ chatId: user.chatId })
                            const index = users.findIndex(u => u.chatId == user.chatId)
                            users.splice(index, 1)
                        }
                    }
                }
                counter += 1
                await ctx.telegram.editMessageText(SWAPNIL, mesg.message_id, null, `Notified to ${counter}/${users.length} people.`)
            }
        } catch (err) {
            await ctx.reply('Some error occured!')
        }
    }
)

sendToAll.command('cancel', async (ctx) => {
    await ctx.scene.leave()
    return await ctx.reply('Operation cancelled!')
})

const districtSelection = new Scenes.WizardScene(
    'district',
    async (ctx) => {
        try {
            const states = await CoWIN.getStates()
            const markupButton = states.reduce((result, value, index, array) => {
                const buttonMap = array.slice(index, index+2)
                if (index % 2 === 0)
                    result.push(buttonMap.map(v => ({ text: v.state_name })))
                return result
            }, [])

            await ctx.reply('Choose your preferred state first. Make sure you choose the state/district whichever\'s pincode you wanna track.', { reply_markup: {
                keyboard: markupButton,
                remove_keyboard: true,
                one_time_keyboard: true
            } })
            return ctx.wizard.next()
        } catch (error) {
            console.log(error)
            await ctx.reply('Something went wrong! try again.')
            if (error instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
                return ctx.scene.leave()
            }
        }
    },
    async (ctx) => {
        try {
            const state_nam = ctx.message.text
            const states = await CoWIN.getStates()
            const { state_id, state_name } = states.find(s => s.state_name.trim() == state_nam.trim())
            if (!state_id) {
                await ctx.reply('Sorry invalid selection. Try again /district and Please choose valid state.', { reply_markup: { remove_keyboard: true } })
                return ctx.scene.leave()
            }
            await User.updateOne({ chatId: ctx.chat.id }, { $set: { stateId: state_id } })
            const districts = await CoWIN.getDistrict(state_id)
            ctx.wizard.state.state_id = state_id
            const markupButton = districts.reduce((result, value, index, array) => {
                const buttonMap = array.slice(index, index+2)
                if (index % 2 === 0)
                    result.push(buttonMap.map(v => ({ text: v.district_name })))
                return result
            }, [])
            await ctx.reply(`You\'ve selected ${state_name}. Please choose your district.`, {
                reply_markup: {
                    keyboard: markupButton,
                    remove_keyboard: true,
                    one_time_keyboard: true
                }
            })
            return ctx.wizard.next()
        } catch (error) {
            console.log(error)
            if (error instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
                return ctx.scene.leave()
            }
        }
    },
    async (ctx) => {
        try {
            const district_nam = ctx.message.text
            const districts = await CoWIN.getDistrict(ctx.wizard.state.state_id)
            const { district_id, district_name } = districts.find(d => d.district_name.trim() == district_nam.trim())
            if (!district_id) {
                await ctx.reply('Sorry invalid selection. Try again /district and Please choose valid district.', { reply_markup: { remove_keyboard: true } })
                return ctx.scene.leave()
            }
            await User.updateOne({ chatId: ctx.chat.id }, { $set: { districtId: district_id, centers: [] } })
            const { walkthrough } = await User.findOne({ chatId: ctx.chat.id }).select('walkthrough')
            await ctx.reply(`You\'ve selected ${district_name}.`, { reply_markup: { remove_keyboard: true } })
            if (walkthrough) {
                await ctx.reply('Amazing! One final step...\nNow lets choose the pincodes you wanna track.')
                return ctx.scene.enter('slot-booking')
            } else {
                await ctx.reply('Now you can /track your desired pincode. You can also change your district whenever you want to by sending /district\nAlso your preferred /center list is also cleared')
            }
            return ctx.scene.leave()
        } catch (error) {
            console.log(error)
            if (error instanceof TelegramError) {
                await User.deleteOne({ chatId: ctx.chat.id })
                return ctx.scene.leave()
            }
        }
    }
)

const stage = new Scenes.Stage([loginWizard, slotWizard, sendToAll, districtSelection, walkthrough])

// bot.use(botUnderMaintain)
bot.use(session())
bot.use(groupDetection)
bot.use(stage.middleware())

/**
 * Commands
 */

bot.help(inviteMiddle, async (ctx) => {
    try {
        let commands = ``
        if (_isAuth(ctx.chat.id)) {
            commands += `/logout = logout from the bot/portal\n`
        }
        commands += `/beneficiaries = to list beneficiaries\n/donate = Please do :)\n/certificate - to download certificate\n/vaccine = To choose your preferred vaccine while tracking\n/snooze = To pause messages for several given time\n/unsnooze = remove message pause and get message on every ~1min interval\n/login = To login with your number!\n/track = to track available slot with given pincode.\n/untrack = untrack your current pincode\n/otp <your-OTP> = during auth if your OTP is wrong then you can try again with /otp command\n/status = check your status\n/district = to set your prefered district for tracking pincodes.\n/locations = Usage: /locations <State Name> -> to get number of users in your state/area who are active on this bot.\n/center - Choose preferred center for autobooking.\n/autobook - for autobooking on tracking pincode with available slots`
        if (ctx.chat.id == SWAPNIL) {
            commands += `\nAdmin commands:\n/sleeptime | /sleeptime <ms>\n/sendall\n/botstat\n/revokeall\n/captchainfo\n/captchatest`
        }
        return await ctx.reply(commands)
    } catch (err) {
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
    }
})

bot.command('id', async (ctx) => await ctx.reply(`Your chat id is: ${ctx.chat.id}`))

bot.start(async (ctx) => {
    if (!(await User.findOne({ chatId: ctx.chat.id }))) {
        await User.create({ chatId: ctx.chat.id, allowed: true, walkthrough: true })
    }
    const msg = `Hi, This bot can operate on selfregistration.cowin.gov.in.\nYou can send /help to know instructions about how to use this bot.\nDeveloped by <a href="https://github.com/SwapnilSoni1999">Swapnil Soni</a>`
    await ctx.reply(msg, { parse_mode: 'HTML' })
    await ctx.reply(`Before you proceed further, Make sure you read the following notes:\n\n - <u>You must have atleast one beneficiary on your registered mobile number.</u>\n - <u>You must use login number which you used to register on cowin portal.</u>\n\nRead previous Bot Changelog here: https://telegra.ph/Cowin-Vaccine-Tracker-Bot-Changelog-06-07`, { parse_mode: 'HTML' })
    const { walkthrough } = await User.findOne({ chatId: ctx.chat.id }).select('walkthrough')
    if (walkthrough) {
        return ctx.scene.enter('walkthrough')
    }
})

bot.command('login', inviteMiddle, async (ctx) => {
    const user = await User.findOne({ chatId: ctx.chat.id })
    if (user) {
        if (user.token && Token.isValid(user.token)) {
            return await ctx.reply('You\'re already logged in! Send /logout to Logout.')
        }
    }

    if (user.otpCount > MAX_OTP_PER_DAY) {
        return await ctx.reply(`Sorry! you've reached max OTP request limit for today! Try tomorrow.\nAlso do not login on CoWIN portal else your account will be banned for 24 hours.`)
    }
    ctx.scene.enter('login')
})

bot.command('otp', inviteMiddle, async (ctx) => {
    const user = await User.findOne({ chatId: ctx.chat.id })
    if (user.token) {
        return await ctx.reply('You\'re already logged in! Send /logout to Logout.')
    }

    if(!user.txnId) {
        return await ctx.reply('You\'ve not initialized login process. Please send /login to continue.')
    }

    try {
        const token = await CoWIN.verifyOtpStatic(ctx.message.text.split(' ')[1], user.txnId)
        await User.updateOne({ chatId: ctx.chat.id }, { token: token })
        return await ctx.reply('Login successful!')
    } catch (err) {
        console.log(err)
        return await ctx.reply('Wrong OTP! Please try again with /otp <your-OTP>')
    }
})

bot.command('logout', inviteMiddle, async (ctx) => {
    try {
        const user = await User.findOne({ chatId: ctx.chat.id })
        if (!user.token) {
            return await ctx.reply('You\'re not logged in! Please /login first.')
        }
        if (user.txnId) {
            await User.updateOne({ chatId: ctx.chat.id }, { txnId: null })
        }
        await User.updateOne({ chatId: ctx.chat.id }, { $set: { token: null, txnId: null, beneficiaries: [], preferredBenef: null } })
        return await ctx.reply('Logged out! Send /login to login. Note: You\'re still tracking your current pincode and age group. Check it with /status')
    } catch (err) {
        if (err.response.status == 403 || err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
        }
    }
})

function expandAppointments(appointments) {
    console.log('Expanding appointments', appointments)
    // seperated by \n at end \t at begining
    let msg = `There ${appointments.length > 1 ? 'are' : 'is'} ${appointments.length} appointment${appointments.length > 1 ? 's' : ''} Booked.\n`
    const appointmentMap = appointments.map(ap => [
        `<b>Center Name</b>: ${ap.name || 'Unavailable'}`,
        `${ap.district ? '<b>District</b>: ' + ap.district : ''}`,
        `<b>Block</b>: ${ap.block_name}`,
        `${ap.state_name ? '<b>State</b>: ' + ap.state_name : ''}`,
        `<b>Center Timings</b>\n: ${[
            `<u><b>From</b></u>: ${ap.from}`,
            `<u><b>To</b></u>: ${ap.to}`,
            `<b>Dose</b>: ${ap.dose}`,
            `<b>Date</b>: ${ap.date}`,
            `<u><b>Your time Slot</b></u>: <u>${ap.slot}</u>`
        ].join('\n\t\t')}`
    ].filter(v => !!v).join('\n'))
    msg += appointmentMap.join("\n")
    return msg
}

const beneficiaryCommand = async (ctx) => {
    const { token } = await User.findOne({ chatId: ctx.chat.id })
    try {
        const ben = await CoWIN.getBeneficiariesStatic(token)
        if (!ben.length) {
            return await ctx.reply('No beneficiaries. Please add beneficiary first from cowin.gov.in and send /beneficiaries again.')
        }
        await User.updateOne({ chatId: ctx.chat.id }, { $set: { beneficiaries: ben } })

        const txts = ben.map(b => `<b>ID:</b> ${b.beneficiary_reference_id}\n<b>Name</b>: ${b.name}\n<b>Birth Year</b>: ${b.birth_year}\n<b>Gender</b>: ${b.gender}\n<b>Vaccination Status</b>: ${b.vaccination_status}\n<b>Vaccine</b>: ${b.vaccine}\n<b>Dose 1 Date</b>: ${b.dose1_date || 'Not vaccinated'}\n<b>Dose 2 Date</b>: ${b.dose2_date || 'Not vaccinated'}\n\n<b>Appointments</b>: ${b.appointments.length ? expandAppointments(b.appointments) : 'No appointments booked.'}\n\n<u>It is recommended to take both doses of same vaccines. Please do not take different vaccine doeses.</u>`)

        for (const txt of txts) {
            await ctx.reply(txt, { parse_mode: 'HTML' })
        }
        const validBenef = ben.filter(b => ((b.dose1_date ? false : true) || (b.dose2_date ? false : true)))
        const markupButton = validBenef.map(b => ([{ text: b.name, callback_data: `benef--${b.beneficiary_reference_id}` }]))
        await ctx.reply('Please choose preferred beneficiary for auto booking.', { reply_markup: {
            inline_keyboard: markupButton
        } })
        return
    } catch (err) {
        console.log(err)
        await User.updateOne({ chatId: ctx.chat.id }, { token: null, txnId: null })
        return await ctx.reply('Token expired! Please /login again. Or maybe you haven\'t added any beneficiary on cowin portal. Please consider adding atleast one from selfregistration.cowin.gov.in')
    }
}
bot.command('beneficiaries', inviteMiddle, authMiddle, beneficiaryCommand)

bot.action(/benef--.*/, async (ctx) => {
    try {
        const benefId = ctx.update.callback_query.data.split('benef--')[1]
        const { beneficiaries, walkthrough } = await User.findOne({ chatId: ctx.update.callback_query.from.id }).select('beneficiaries walkthrough')
        const matched = beneficiaries.find(b => b.beneficiary_reference_id == benefId)
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { preferredBenef: matched } })
        await ctx.editMessageText(`<b>ID:</b> ${matched.beneficiary_reference_id}\n<b>Name</b>: ${matched.name}\n<b>Birth Year</b>: ${matched.birth_year}\n<b>Gender</b>: ${matched.gender}\n\n\nNow you can use /autobook feature.`, { parse_mode: 'HTML' })
        if (walkthrough) {
            if (matched.dose1_date) {
                await ctx.reply(`Great! The beneficiary has taken ${matched.vaccine}. So setting default tracking to ${matched.vaccine}. You can change your vaccine tracking by sending /vaccine anytime.`)
                await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { vaccine: matched.vaccine } })
                const FEES = [
                    { text: 'Free', callback_data: `fee-type--Free` },
                    { text: 'Paid', callback_data: `fee-type--Paid` },
                    { text: 'Any', callback_data: `fee-type--ANY` }
                ]
                return ctx.reply('Choose vaccine Fee Type.', {
                    reply_markup: {
                        inline_keyboard: [
                            FEES
                        ]
                    }
                })
            } else {
                await ctx.reply(`It seems like the beneficiary hasn't been vaccinated OR fully vaccinated already. So choose the vaccine type you want to track first.`)
                return vaccineCommand(ctx)
            }
        }
    } catch (err) {
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return ctx.scene.leave()
        }
    }
})

const vaccineCommand = async (ctx) => {
    try {
        const vaccines = ['COVISHIELD', 'COVAXIN', 'SPUTNIK V', 'ANY']
        const markupButton = [vaccines.map(v => ({ text: v, callback_data: `vaccine--${v}`}))]
        return await ctx.reply(`Choose your preferred vaccine to track.`, { reply_markup: {
            inline_keyboard: markupButton
        } })
    } catch (error) {
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
    }
}

bot.command('vaccine', inviteMiddle, vaccineCommand)

const vaccineAction = async (ctx) => {
    try {
        const vaccine = ctx.update.callback_query.data.split('vaccine--')[1]
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { vaccine } })
        await ctx.editMessageText(`You've chosen: <b>${vaccine}</b>\nYou will be notified only for ${vaccine} slots available only.\nIf you wish to change your preferred vaccine then send /vaccine to change.`, { parse_mode: 'HTML' })
        const FEES = [
            { text: 'Free', callback_data: `fee-type--Free` },
            { text: 'Paid', callback_data: `fee-type--Paid` },
            { text: 'Any', callback_data: `fee-type--ANY` }
        ]
        return ctx.reply('Choose vaccine Fee Type.', {
            reply_markup: {
                inline_keyboard: [
                    FEES
                ]
            }
        })
    } catch (err) {
        console.log(err)
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
    }
}
bot.action(/vaccine--.*/, vaccineAction)

bot.action(/fee-type--.*/, async (ctx) => {
    try {
        const feeType = ctx.update.callback_query.data.split('fee-type--')[1]
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { feeType } })
        await ctx.editMessageText(`You've chosen fee type: <b>${feeType}</b>\nYou can check your current status by sending /status`, { parse_mode: 'HTML' })
        const { walkthrough } = await User.findOne({ chatId: ctx.update.callback_query.from.id }).select('walkthrough')
        if (walkthrough) {
            await ctx.reply('We\'re almost there! Now lets choose the district!')
            return ctx.scene.enter('district')
        }
    } catch (error) {
        console.log(error)
        if (error instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
    }
})

bot.command('track', inviteMiddle, async (ctx) => {
    try {
        const { districtId } = await User.findOne({ chatId: ctx.chat.id })
        if (!districtId) {
            return await ctx.reply('You haven\'t selected your prefered district. Please select your /district first.')
        }
        const { tracking } = await User.findOne({ chatId: ctx.chat.id }).select('tracking')
        console.log(tracking)
        if (tracking.length >= MAX_TRACKING_ALLOWED) {
            await User.updateOne({ chatId: ctx.chat.id }, { $set: { tracking: tracking.slice(0, MAX_TRACKING_ALLOWED) } })
            return await ctx.reply(`Sorry you can track maximum ${MAX_TRACKING_ALLOWED} pincodes. send /untrack to remove one of the pincode.`)
        }
        return ctx.scene.enter('slot-booking')
    } catch (err) {
        console.log(err)
        await bot.telegram.sendMessage(SWAPNIL, 'Err occured for user ' + ctx.chat.id)
        return await ctx.reply('Something went wrong please try again later!')
    }
})

bot.command('untrack', inviteMiddle, async (ctx) => {
    try {
        const { tracking } = await User.findOne({ chatId: ctx.chat.id })
        if (!Array.isArray(tracking) || !tracking.length) {
            return await ctx.reply('You aren\'t tracking any pincode. send /track to start tracking.')
        }
        const markupButton = tracking.map((t) => ([{ text: `Pin: ${t.pincode} | Age: ${t.age_group}`, callback_data: `remove-pin--${t.id}` }]))
        return await ctx.reply('Choose which pincode to remove.', { reply_markup: { inline_keyboard: markupButton } })
    } catch (error) {
        console.log(error)
        if (error instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
        return await ctx.reply('Something went wrong please try again later!')
    }
})
bot.action(/remove-pin--.*/, async (ctx) => {
    try {
        const trackingId = ctx.update.callback_query.data.split('remove-pin--')[1]
        const { tracking } = await User.findOne({ chatId: ctx.update.callback_query.from.id }).select({ tracking: { $elemMatch: { _id: trackingId } } })
        const { pincode, age_group } = tracking.find(t => t.id == trackingId)
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $pull: { tracking: { _id: trackingId } } })
        return await ctx.editMessageText(`Removed ${pincode}|${age_group} from your tracking list.`)
    } catch (err) {
        console.log(err)
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { tracking: [] } })
        await ctx.reply('Some error occured! your old tracking pins are removed! Please try again.')
    }
})

bot.command('district', inviteMiddle, async (ctx) => {
    try {
        ctx.scene.enter('district')
    } catch (error) {
        console.log(error)
        await ctx.reply('Something went wrong! try again.')
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
    }
})

const autoBookCommand = async (ctx) => {
    try {
        const onBtn = { text: 'Turn ON ✔️', callback_data: 'turn_on' }
        const offBtn = { text: 'Turn OFF ✖️', callback_data: 'turn_off' }
        const keyboard = []
        const { autobook } = await User.findOne({ chatId: ctx.chat.id }).select('autobook')
        if (autobook) {
            keyboard.push(offBtn)
        } else {
            keyboard.push(onBtn)
        }
        return await ctx.reply('Choose switch for autobook.\n<b>What is this?</b>\nIts a feature to book an available slot in youre desired pincode if your token is valid within the given time.\n\n<b>Note</b>: <u>Once you login. You will be auto logged out from cowin by itself after 15minutes. So you will get an alert message to login again if you\'ve turned autobook switch ON. So use this feature only when you need.</u>\n\n<b>How it works?</b>\nThe bot will work normally like informing you for available slots. But with autobook it will also try to book a slot to any available center in your desired pincode.', {
            reply_markup: {
                inline_keyboard: [
                    keyboard
                ]
            },
            parse_mode: 'HTML'
        })
    } catch (error) {
        console.log(error)
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return
        }
    }
}

bot.command('autobook', inviteMiddle, switchMiddle, benefMiddle, pinCheckMiddle, autoBookCommand)

bot.action('turn_on', async (ctx) => {
    try {
        const { walkthrough, preferredBenef } = await User.findOne({ chatId: ctx.update.callback_query.from.id }).select('walkthrough preferredBenef')
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { autobook: true, walkthrough: false } })
        await ctx.editMessageText(`Autobook is now turned <b>ON</b>\nYour preferred beneficiary: ${preferredBenef.name}`, { parse_mode: 'HTML' })
        if (walkthrough) {
            return await ctx.reply('Congrats! You\'re now all set-up :)\nYou can send /status to check your configuration status. You can send /help to know about all the commands. :)\nThats all for setup. Stay safe. <3')
        }
    } catch (error) {
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { autobook: false, beneficiaries: [] } })
        await ctx.reply('Something went wrong! Please choose your /beneficiaries again and try to turn on /autobook again.')
        console.log(error)
    }
})

bot.action('turn_off', async (ctx) => {
    try {
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { $set: { autobook: false } })
        return await ctx.editMessageText('Autobook is now turned <b>OFF</b>', { parse_mode: 'HTML' })
    } catch (error) {
        console.log(error)
    }
})

bot.command('snooze', inviteMiddle, async (ctx) => {
    const markupButton = SNOOZE_LITERALS.reduce((result, value, index, array) => {
        const buttonMap = array.slice(index, index + 2)
        if (index % 2 === 0)
            result.push(buttonMap.map(v => ({ text: v.name, callback_data: `snooze_req--${v.seconds}` })))
        return result
    }, [])

    return await ctx.reply('Choose a time to snooze.', { reply_markup: {
        inline_keyboard: markupButton
    } })
})

bot.command('unsnooze', inviteMiddle, async (ctx) => {
    await User.updateOne({ chatId: ctx.chat.id }, { snoozeTime: null, snoozedAt: null })
    return await ctx.reply('Unsoozed! You can /snooze your messages if they\'re annoying.')
})

function expandTracking(tracking) {
    return tracking.map(t => `\t<b>Pincode</b>: ${t.pincode} | <b>Age Group</b>: ${t.age_group} | <b>Dose</b>: ${t.dose || 'Any Dose'}`).join('\n')
}

bot.command('status', inviteMiddle, async (ctx) => {
    try {
        const user = await User.findOne({ chatId: ctx.chat.id })
        const { stateId, districtId } = user
        let district_name = null
        const center_names = []
        if (districtId) {
            const districts = await CoWIN.getDistrict(stateId)
            district_name = districts.find(d => d.district_id == districtId).district_name
            if (user.centers.length) {
                const centers = await CoWIN.getCentersByDist(districtId)
                const chosenCenters = centers.filter(c => user.centers.find(cid => cid == c.center_id))
                for (const cc of chosenCenters) {
                    center_names.push(cc.name)
                }
            }
        }
        if (!Token.isValid(user.token)) {
            await User.updateOne({ chatId: ctx.chat.id }, { $set: { token: null } })
            user.token = null
        }
        const txt = `<b>ChatId</b>: ${user.chatId}\n<b>SnoozeTime</b>: ${user.snoozeTime ? secondsToHms(Math.abs(parseInt(Date.now()/1000) - user.snoozeTime)) : 'Not snoozed'}\n<b>Tracking Pincode</b>: ${Array.isArray(user.tracking) && user.tracking.length ? '\n' + expandTracking(user.tracking) : 'No pincode'}\n<b>Logged in?</b>: ${user.token ? 'Yes' : 'No'}\n<b>Prefered District</b>: ${district_name || 'None'}\n<b>Preferred Vaccine</b>: ${user.vaccine}\n<b>Preferred Center Type</b>: ${user.feeType}\n<b>Preferred Beneficiary</b>: ${user.preferredBenef && user.preferredBenef.name || 'No Beneficiary chosen'}\n<b>Autobook</b>: ${user.autobook ? 'ON' : 'OFF'}\n<b>OTP Requested Today</b>: ${user.otpCount}\n<b>Preferred Centers</b>: ${center_names.length ? center_names.join('\n\t') : 'ANY'}\n<b>Session Expiration</b>: ${user.token && Token.isValid(user.token) ? secondsToHms(Token.getExpirationTime(user.token)) : 'Not logged in'}\n\nType /help for more info.`
        return await ctx.reply(txt, { parse_mode: 'HTML' })
    } catch (err) {
        await ctx.reply('Something went wrong! Please try again!')
        console.log(err)
    }
})

bot.command('revokeall', async (ctx) => {
    if (ctx.chat.id == SWAPNIL) {
        await ctx.reply('Revoking everyone\'s token!')
        const users = await User.find({
            $or: [
                {token: { $ne: null }},
                {autobook: true}
            ]
        })
        for (const user of users) {
            if (user.chatId) {
                await User.updateOne({ chatId: user.chatId }, { $set: { token: null, autobook: false } })
                try {
                    await bot.telegram.sendMessage(user.chatId, 'Bot status update!\n<b>Autobook</b>: turned off\n<b>Token</b>: Revoked\n\nYou can again /autobook and /login if you wish to.', { parse_mode: 'HTML' })
                } catch (err) {
                    if (err instanceof TelegramError) {
                        await User.deleteOne({ chatId: ctx.chat.id })
                    }
                }
            }
        }
        return await ctx.reply(`Revoked ${users.length} user\'s token!`)
    }
})

bot.command('sleeptime', async (ctx) => {
    if (ctx.chat.id == SWAPNIL) {
        try {
            const ms = ctx.message.text.split(' ')[1]
            if (!ms) {
                throw new Error('bhay ms to pass karo')
            }
            TRACKER_SLEEP_TIME = parseInt(ms)
            return await ctx.reply('Sleep time updated for tracker.')
        } catch(err) {
            await ctx.reply('Current sleeptime for tracker is ' + TRACKER_SLEEP_TIME + 'ms')
            return ctx.reply('Please provide milisecond /sleeptime <ms> for tracker')
        }
    }
})

bot.action(/snooze_req--\d+/, async (ctx) => {
    try {
        const seconds = ctx.update.callback_query.data.split('snooze_req--')[1]
        const lit = SNOOZE_LITERALS.find(v => v.seconds === parseInt(seconds))
        await ctx.editMessageText(`You've snoozed bot messages for ${lit.name}\nYou can unsnooze using /unsnooze`)
        const currentTime = parseInt(Date.now()/1000)
        await User.updateOne({ chatId: ctx.update.callback_query.from.id }, { snoozeTime: currentTime + lit.seconds, snoozedAt: currentTime })
    } catch (err) {
        if (err instanceof TelegramError) {
            await User.deleteOne({ chatId: ctx.chat.id })
            return ctx.reply('Something went wrong!')
        }
    }
})

bot.command('center', inviteMiddle, async (ctx) => {
    try {
        const { districtId } = await User.findOne({ chatId: ctx.chat.id }).select('districtId')
        if (!districtId) {
            return await ctx.reply('You haven\'t selected your prefered district. Please select your /district first.')
        }
        return await ctx.reply('Choose one from either to add center or remove from chosen ones.\n\nHow this works?\nWhenever you choose your preferred center for autobooking, then bot will try to book for that specific center only. If you dont have any preferred center in your list, Then ANY open center will be booked by bot.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Add', callback_data: 'center--add-1' }, { text: 'Remove', callback_data: 'center--remove-1' }]
                ]
            }
        })
    } catch (error) {
        if (error instanceof TelegramError) {
            console.log(error)
            // await User.deleteOne({ chatId: ctx.chat.id })
            return ctx.reply('Something went wrong!')
        }
    }
})

bot.action(/center--add-\d+/, async (ctx) => {
    try {
        const MAX_PER_PAGE = 7
        const page = parseInt(ctx.update.callback_query.data.split('center--add-')[1]) || 1
        await ctx.editMessageText('Fetching please wait...')
        const { districtId, centers: uCenters, tracking } = await User.findOne({ chatId: ctx.chat.id }).select('districtId centers tracking')
        const centers = await CoWIN.getCentersByDist(districtId)
        // const centersChosen = centers.filter(c => uCenters.find(cid => cid == c.center_id ))
        const remainingCenters = centers.filter(c => !uCenters.find(cid => cid == c.center_id) && tracking.find(t => t.pincode == c.pincode))
        const remainingButtons = remainingCenters.map(center => {
            return [{ text: center.name, callback_data: `choose-center--${center.center_id}` }]
        })

        const start = (page - 1) * MAX_PER_PAGE
        const end = start + MAX_PER_PAGE

        const btnlist = remainingButtons.slice(start, end)

        const nextBtn = { text: 'Next »', callback_data: `center--add-${page+1}` }
        const backBtn = { text: '« Back', callback_data: `center--add-${page-1}` }

        const totalPages = Math.ceil(remainingButtons.length / MAX_PER_PAGE)
        if (totalPages > 1) {
            if (page == 1) {
                btnlist.push([nextBtn])
            } else if (page == totalPages) {
                btnlist.push([backBtn])
            } else {
                btnlist.push([backBtn, nextBtn])
            }
        }

        return await ctx.editMessageText(`Choose your desired center for autobooking.\nNote: Your centers are fetched from your preferred /district and your /track -ed pincodes.\nTotal Centers: ${remainingCenters.length}\nTotal Pages: ${totalPages}\nCurrent Page: ${page}`, {
            reply_markup: {
                inline_keyboard: btnlist
            }
        })
    } catch (error) {
        console.log(error)
        // if (error instanceof TelegramError) {
        //     await User.deleteOne({ chatId: user.chatId })
        // }
    }
})

bot.action(/center--remove-\d+/, async (ctx) => {
    try {
        await ctx.editMessageText('Fetching please wait...')
        const { districtId, centers: uCenters } = await User.findOne({ chatId: ctx.chat.id }).select('districtId centers')
        if (!uCenters.length) {
            return await ctx.editMessageText('You haven\'t selected any preferred center. Please add atleast one preferred center.')
        }
        const MAX_PER_PAGE = 7
        const page = parseInt(ctx.update.callback_query.data.split('center--remove-')[1]) || 1

        const centers = await CoWIN.getCentersByDist(districtId)
        const centersChosen = centers.filter(c => uCenters.find(cid => cid == c.center_id ))

        const chosenButtons = centersChosen.map(center => {
            return [{ text: center.name, callback_data: `remove-center--${center.center_id}` }]
        })
        const start = (page - 1) * MAX_PER_PAGE
        const end = start + MAX_PER_PAGE

        const btnlist = chosenButtons.slice(start, end)

        const nextBtn = { text: 'Next »', callback_data: `center--remove-${page+1}` }
        const backBtn = { text: '« Back', callback_data: `center--remove-${page-1}` }

        const totalPages = Math.ceil(chosenButtons.length / MAX_PER_PAGE)
        if (totalPages > 1) {
            if (page == 1) {
                btnlist.push([nextBtn])
            } else if (page == totalPages) {
                btnlist.push([backBtn])
            } else {
                btnlist.push([backBtn, nextBtn])
            }
        }

        return await ctx.editMessageText(`Remove your desired center for autobooking.\nNote: Your centers are fetched from your preferred /district\nTotal Centers: ${centersChosen.length}\nTotal Pages: ${totalPages}\nCurrent Page: ${page}`, {
            reply_markup: {
                inline_keyboard: btnlist
            }
        })
    } catch (error) {
        console.log(error)
        // if (error instanceof TelegramError) {
        //     await User.deleteOne({ chatId: user.chatId })
        // }
    }
})

// perform
bot.action(/choose-center--.*/, async (ctx) => {
    try {
        const centerId = ctx.update.callback_query.data.split('choose-center--')[1]
        const { districtId } = await User.findOneAndUpdate({ chatId: ctx.update.callback_query.from.id }, { $push: { centers: centerId } })
        const centers = await CoWIN.getCentersByDist(districtId)
        const center = centers.find(c => c.center_id == centerId)
        return await ctx.editMessageText(`You\'ve added <b>${center.name}</b> to your preferred centers list.`, { parse_mode: 'HTML' })
    } catch (error) {
        console.log(error)
    }
})
bot.action(/remove-center--.*/, async (ctx) => {
    try {
        const centerId = ctx.update.callback_query.data.split('remove-center--')[1]
        const { districtId } = await User.findOneAndUpdate({ chatId: ctx.update.callback_query.from.id }, { $pull: { centers: centerId } })
        const centers = await CoWIN.getCentersByDist(districtId)
        const center = centers.find(c => c.center_id == centerId)
        return await ctx.editMessageText(`You\'ve removed <b>${center.name}</b> from your preferred centers list.`, { parse_mode: 'HTML' })
    } catch (error) {
        console.log(error)
    }
})

bot.command('test', async (ctx) => {
    if (ctx.chat.id == SWAPNIL) {
        try {


            // const payUrl = "swapnil.soni12345@okaxis" // encodeURI("upi://pay?pa=swapnil.soni12345@okaxis&pn=Swapnil&tn=For vaccine bot :)&cu=INR")
            // await bot.telegram.sendMessage(SWAPNIL,
            //     `Hey! I know getting vaccination sot is really a tough competition now. :)\nI spent my days and night to maintain this bot. Would you like to buy me a coffee? ^.^\nYou can send me the prize on my UPI if you wish to. Thanks.\n\n${payUrl}`,
            //     { parse_mode: 'HTML' }
            // )
        } catch (err) {
            await ctx.reply('Some error:' + err.stack)
        }
    }
})

bot.command('captchatest', async (ctx) => {
    if (ctx.chat.id == SWAPNIL) {
        try {
            const token = await Token.getAnyValidToken()
            if (!token) {
                return await ctx.reply('No valid token found!')
            }
            const result = await CoWIN.getCaptcha(token, ctx.chat.id)
            if (!result) {
                return await ctx.reply('Not working!')
            }
            return await ctx.reply('Captcha working!\n' + result)
        } catch (error) {
            await ctx.reply(error.response.data.error)
        }
    }
})

bot.command('certificate', inviteMiddle, authMiddle, async (ctx) => {
    try {
        const { token } = await User.findOne({ chatId: ctx.chat.id }).select('token')
        const ben = await CoWIN.getBeneficiariesStatic(token)
        if (!ben.length) {
            return await ctx.reply('No beneficiaries. Please add beneficiary first from cowin.gov.in')
        }
        await User.updateOne({ chatId: ctx.chat.id }, { $set: { beneficiaries: ben } })

        const validbenef = ben.filter(b => ((b.dose1_date ? true : false) || (b.dose2_date ? true : false)))
        const benefButtons = validbenef.map(b => [{ text: b.name, callback_data: `certificate--${b.beneficiary_reference_id}` }])

        if (!validbenef.length) {
            return await ctx.reply('None of the beneficiary is vaccinated.')
        }

        return await ctx.reply(`Choose the beneficiary whom you want to downlaod certificate for.`, {
            reply_markup: {
                inline_keyboard: benefButtons
            }
        })
    } catch (error) {
        console.log(error)
    }
})

bot.action(/certificate--\d+/, async (ctx) => {
    try {
        await ctx.editMessageText('Fetching certificate...')
        const { token, beneficiaries } = await User.findOne({ chatId: ctx.chat.id }).select('token beneficiaries')
        const benefRefId = ctx.update.callback_query.data.split('certificate--')[1]
        const certPath = await CoWIN.downloadCertificate(benefRefId, token, ctx.update.callback_query.from.id)
        const benef = beneficiaries.find(b => b.beneficiary_reference_id == benefRefId)
        const benefInfo = [
            `<b>Name</b>: ${benef.name}`,
            `<b>Vaccination Status</b>: ${benef.vaccination_status}`,
            `<b>Vaccine</b>: ${benef.vaccine}`,
            `<b>Ref ID</b>: ${benefRefId}`
        ]
        await ctx.editMessageText('Fetched!\n' + benefInfo.join('\n'), { parse_mode: 'HTML' })
        return await ctx.replyWithDocument({ source: fs.createReadStream(certPath), filename: 'Certificate.pdf' })
    } catch (error) {
        console.log(error)
    }
})

bot.command('walkthrough', async (ctx) => {
    await User.updateOne({ chatId: ctx.chat.id }, { $set: { walkthrough: true } })
    return ctx.reply('walkthrough: true')
})

async function bookSlot(user, uCenter) {
    await bot.telegram.sendMessage(user.chatId, 'Attempting to book slot...')
    try {
        await User.updateOne({ chatId: user.chatId }, { $set: { autobook: false } })
        const captchaResult = await CoWIN.getCaptcha(user.token, user.chatId)
        const sess = uCenter.sessions.find(s => s.available_capacity > 0)
        const _schedule = switchChoose(user.preferredBenef)
        const payload = {
            beneficiaries: [user.preferredBenef.beneficiary_reference_id],
            captcha: captchaResult,
            center_id: uCenter.center_id,
            dose: getDoseCount(user.preferredBenef),
            session_id: sess.session_id,
            slot: sess.slots[Math.floor(Math.random() * sess.slots.length)]
        }
        if (_schedule === 'reschedule') {
            payload.appointment_id = getFutureAppointment(user.preferredBenef.appointments)
        }
        const appointmentId = await CoWIN.schedule(user.token, payload, _schedule)
        await sleep(800)
        const beneficiaries = await CoWIN.getBeneficiariesStatic(user.token)
        await User.updateOne({ chatId: user.chatId }, { $set: { beneficiaries: beneficiaries } })
        const bookedOne = beneficiaries.find(b => b.beneficiary_reference_id == user.preferredBenef.beneficiary_reference_id)
        const appo = bookedOne.appointments.length ? expandAppointments([bookedOne.appointments.find(a => a.appointment_id == appointmentId)]) : false
        await bot.telegram.sendMessage(user.chatId, `Successfully ${_schedule == 'schedule' ? 'scheduled' : 'rescheduled'} appointment! 🎉\nAutobook is now turned off.`)
        await User.updateOne({ chatId: user.chatId }, { $set: { autobook: false } })
        if (appo) {
            await bot.telegram.sendMessage(user.chatId, `<b>Beneficiary</b>: ${bookedOne.name}\n${appo}`, { parse_mode: 'HTML' })
        }
        await bot.telegram.sendMessage(SWAPNIL, `Successfully ${_schedule == 'schedule' ? 'scheduled' : 'rescheduled'} appointment! 🎉\n<b>Beneficiary</b>: ${bookedOne.name}\n${appo}\n\<b>AppointmentID</b>: ${appointmentId}`, { parse_mode: 'HTML' })
        try {
            const slip = await CoWIN.getAppointmentSlip(appointmentId, user.token, user.chatId)
            await bot.telegram.sendDocument(user.chatId, { source: fs.createReadStream(slip), filename: 'Appointment Slip.pdf' })
            await bot.telegram.sendDocument(SWAPNIL, { source: fs.createReadStream(slip), filename: 'Appointment Slip.pdf' })
            // await bot.telegram.sendLocation(user.chatId, uCenter.lat, uCenter.long, { allow_sending_without_reply: true })
        } catch (error) {
            await bot.telegram.sendMessage(SWAPNIL, 'Error in sending document!\n' + error.toString())
        }
        finally {
            const payUrl = "<code>swapnil.soni12345@okaxis</code>" // encodeURI("upi://pay?pa=swapnil.soni12345@okaxis&pn=Swapnil&tn=For vaccine bot :)&cu=INR")
            await bot.telegram.sendMessage(user.chatId,
                `Hey! I know getting vaccination slot is really a tough competition now. :)\nI spent my days and night to maintain this bot. Would you like to buy me a coffee? ^.^\nYou can send me the prize on my UPI if you wish to. Thanks.\n\n${payUrl}`,
                { parse_mode: 'HTML' }
            )
        }
    } catch (err) {
        await User.updateOne({ chatId: user.chatId }, { $set: { autobook: true } })
        await bot.telegram.sendMessage(user.chatId, 'Failed to book appointment. Please try yourself once. Sorry.')
        if ('response' in err) {
            console.log(err.response.data)
            // await bot.telegram.sendMessage(SWAPNIL, `Reason: ${err.response.data.errorCode}: ${err.response.data.error}`)
            await bot.telegram.sendMessage(user.chatId, `Reason: ${err.response.data.errorCode}: ${err.response.data.error}`)
        } else {
            if (!(err instanceof TypeError)) {
                await bot.telegram.sendMessage(SWAPNIL, 'Somethings wrong\n' + err.toString() + '\n' + err.stack)
                fs.writeFileSync('wrong.txt', err.toString() + '\n=======', { flag: 'a' })
            }
        }
    }
}

async function inform(user, userCenters, userdata) {
    let informedUser = false
    try {
        const messages = generateMessages(userCenters, userdata)
        for (const txt of messages) {
            await bot.telegram.sendMessage(user.chatId, txt, { parse_mode: 'HTML' })
            console.log('Informed user!')
            informedUser = true
        }
    } catch (err) {
        console.log('Inform errors', err)
        if (err instanceof TelegramError && err.response.error_code !== 429) {
            await bot.telegram.sendMessage(SWAPNIL, 'Inform error\n' + err.toString())
            await User.deleteOne({ chatId: user.chatId })
        }
    }
    for (const uCenter of userCenters) {
        try {
            if (user.autobook && !user.preferredBenef.beneficiary_reference_id) {
                await bot.telegram.sendMessage(user.chatId, 'No preferred beneficiary set. Please set by sending /beneficiaries')
                continue
            }
        } catch (err) {
            await bot.telegram.sendMessage(user.chatId, 'No preferred beneficiary set. Please set by sending /beneficiaries')
            continue
        }
        try {
            const { autobook } = await User.findOne({ chatId: user.chatId }).select('autobook')
            user.autobook = autobook
            if (
                user.autobook &&
                Token.isValid(user.token) &&
                checkValidVaccine(uCenter, user.preferredBenef) &&
                checkCenterToBook(uCenter, user.centers)
            ) {
                bookSlot(user, uCenter)
            }
        } catch (err) {
            await User.deleteOne({ chatId: user.chatId })
        }
    }
    try {
        if (informedUser) {
            await bot.telegram.sendMessage(user.chatId, 'Stop alerts? Have you booked the date?\nOr you can also /snooze the messages for a while :)', { reply_markup: {
                inline_keyboard: [
                    [ { text: 'Yes 👍', callback_data: `yes_booked` }, { text: 'No 👎', callback_data: 'not_booked' } ]
                ]
            } })
        }
    } catch (err) {
        console.log(err)
    }
}

async function checkTokens(users) {
    console.log('CHECKING TOKENS....')
    for (let user of users) {
        user = await User.findOne({ chatId: user.chatId })
        if (!user) {
            continue
        }
        if (!user.allowed) {
            continue
        }
        if (user.snoozeTime && user.snoozeTime > parseInt(Date.now() / 1000)) {
            console.log('User is snoozed!')
            // skip the user
            continue
        }
        if (user.snoozeTime && user.snoozeTime < parseInt(Date.now() / 1000)) {
            console.log('Snooze timeout for user!')
            await User.updateOne({ chatId: user.chatId }, { snoozeTime: null })
            try {
                await bot.telegram.sendMessage(user.chatId, 'You\'re now unsnoozed.')
            } catch(err) { }
        }
        try {
            const { autobook, token } = await User.findOne({ chatId: user.chatId }).select('autobook token')
            user.autobook = autobook
            user.token = token
        } catch (err) {
            if (err instanceof TypeError) {
                continue
            }
        }
        if (user.autobook && (!(Token.isValid(user.token)) || !(user.token) )) {
            try {
                const { expireCount } = await User.findOne({ chatId: user.chatId }).select('expireCount')
                if (expireCount >= 5) {
                    console.log('Reached expire count!')
                    await bot.telegram.sendMessage(user.chatId, 'Since you haven\'t logged in from last 5minutes. I\'ve turned off autobooking for you. You can turn it on again anytime you want by sending /autobook')
                    await User.updateOne({ chatId: user.chatId }, { $set: { expireCount: 0, autobook: false } })
                    continue
                }
                console.log('Notifying expired token...')
                if (expireCount > 1) {
                    const remainingMinutes = 5 - expireCount
                    await bot.telegram.sendMessage(user.chatId, `Token expired! Please /login again.\nI\'m reminding you to login in order to book vaccine slots automatically. I\'ll keep reminding you every minute for next ${remainingMinutes}minute${remainingMinutes > 1 ? 's' : ''} if you don\'t login.`)
                } else {
                    await bot.telegram.sendMessage(user.chatId, 'Token expired! Please /login again.\nYou will be notified every 15min after session gets expired. If you wish to stop this session expire alerts, please consider turning off /autobook')
                }
                await User.updateOne({ chatId: user.chatId }, { $set: { token: null }, $inc: { expireCount: 1 } })
                await sleep(100)
            } catch (err) {
                console.log(err)
                if (err instanceof TelegramError && err.response.error_code !== 429) {
                    await User.deleteOne({ chatId: user.chatId })
                }
            }
        }
        if (!user.autobook && !(Token.isValid(user.token))) {
            try {
                await User.updateOne({ chatId: user.chatId }, { $set: { token: null } })
            } catch (error) {
            }
        }
    }
}

var TRACKER_ALIVE = false

async function trackAndInform() {
    console.log('Fetching information')
    const users = await User.find({ allowed: true })
    shuffle(users)
    const districtIds = [...new Set(users.filter(u => u.districtId).map(u => parseInt(u.districtId)))]
    // console.log(districtIds)
    if (!districtIds.length) {
        return
    }
    for (const districtId of districtIds) {
        try {
            const centers = await CoWIN.getCentersByDist(districtId)
            await sleep(TRACKER_SLEEP_TIME)
            TRACKER_ALIVE = true
            console.log('Centers:', centers.length, 'District:', districtId)
            const available = centers.reduce((acc, center) => {
                const tmpCenter = { ...center }
                const sessions = center.sessions.filter(session => (session.available_capacity > 0) && (session.slots.length > 0))
                if (sessions.length) {
                    tmpCenter.sessions = sessions
                    acc.push(tmpCenter)
                }
                return acc
            }, [])

            const validUsers = users.reduce((valid, userdata) => {
                if (userdata.allowed && Array.isArray(userdata.tracking) && userdata.tracking.length) {
                    const tracking = userdata.tracking.filter(t =>
                        (available.reduce((result, center) => {
                            if (
                                (center.pincode == t.pincode)
                            ) {
                                const filtSessions = center.sessions.filter(session => {
                                    if (t.dose !== 0) {
                                        if (
                                            (t.dose == 1) &&
                                            (session.available_capacity_dose1 > 0) &&
                                            (session?.allow_all_age == true ? true : session.min_age_limit == t.age_group) &&
                                            (userdata.vaccine != 'ANY' ? session.vaccine == userdata.vaccine : true)
                                        ) {
                                            return true
                                        }

                                        else if (
                                            (t.dose == 2) &&
                                            (session.available_capacity_dose2 > 0) &&
                                            (session?.allow_all_age == true ? true : session.min_age_limit == t.age_group) &&
                                            (userdata.vaccine != 'ANY' ? session.vaccine == userdata.vaccine : true)
                                        ) {
                                            return true
                                        }
                                    }
                                    else {
                                        if (
                                            (session.available_capacity > 0) &&
                                            (session?.allow_all_age == true ? true : session.min_age_limit == t.age_group) &&
                                            (userdata.vaccine != 'ANY' ? session.vaccine == userdata.vaccine : true)
                                        ) {
                                            return true
                                        }
                                    }
                                })
                                if (filtSessions.length) {
                                    const dup = { ...center }
                                    dup.sessions = filtSessions
                                    result.push(dup)
                                }
                            }
                            return result
                        }, [])).length
                    )
                    if (tracking.length) {
                        userdata.tracking = tracking
                        valid.push(userdata)
                    }
                }
                return valid
            }, [])

            // TODO: add 90 users to inform on each chunk to avoid tg rate limit
            shuffle(validUsers)
            TRACKER_ALIVE = true
            for (const user of validUsers) {
                //double check
                if (!user.allowed) {
                    continue
                }
                if (user.snoozeTime && user.snoozeTime > parseInt(Date.now() / 1000)) {
                    console.log('User is snoozed!')
                    // skip the user
                    continue
                }
                if (!user.districtId) {
                    console.log('No district id! Please send /district to set your prefered district.')
                    try {
                        await bot.telegram.sendMessage(user.chatId, 'No district id! Please send /district to set your prefered district.')
                    } catch (err) {
                        if (err instanceof TelegramError) {
                            await User.deleteOne({ chatId: user.chatId })
                        }
                    }
                    continue
                }


                if (user.snoozeTime && user.snoozeTime < parseInt(Date.now() / 1000)) {
                    console.log('Snooze timeout for user!')
                    await User.updateOne({ chatId: user.chatId }, { snoozeTime: null })
                    try {
                        await bot.telegram.sendMessage(user.chatId, 'You\'re now unsnoozed.')
                    } catch(err) { }
                }

                for (const trc of user.tracking) {
                    const userdata = { pincode: trc.pincode, age_group: trc.age_group, trackingId: trc.id, dose: trc.dose }
                    TRACKER_ALIVE = true
                    const userCenters = (available.reduce((result, center) => {
                        if (
                            (center.pincode == userdata.pincode) &&
                            (user.feeType != 'ANY' ? user.feeType == center.fee_type : true)
                        ) {
                            const filtSessions = center.sessions.filter(session => {
                                if (userdata.dose !== 0) {
                                    if (
                                        (userdata.dose == 1) &&
                                        (session.available_capacity_dose1 > 0) &&
                                        (session?.allow_all_age == true ? true : session.min_age_limit == userdata.age_group) &&
                                        (user.vaccine != 'ANY' ? session.vaccine == user.vaccine : true)
                                    ) {
                                        return true
                                    }

                                    else if (
                                        (userdata.dose == 2) &&
                                        (session.available_capacity_dose2 > 0) &&
                                        (session?.allow_all_age == true ? true : session.min_age_limit == userdata.age_group) &&
                                        (user.vaccine != 'ANY' ? session.vaccine == user.vaccine : true)
                                    ) {
                                        return true
                                    }
                                }
                                else {
                                    if (
                                        (session.available_capacity > 0) &&
                                        (session?.allow_all_age == true ? true : session.min_age_limit == userdata.age_group) &&
                                        (user.vaccine != 'ANY' ? session.vaccine == user.vaccine : true)
                                    ) {
                                        return true
                                    }
                                }
                            })
                            if (filtSessions.length) {
                                const dup = { ...center }
                                dup.sessions = filtSessions
                                result.push(dup)
                            }
                        }
                        return result
                    }, []))
                    if (userCenters.length) {
                        TRACKER_ALIVE = true
                        inform(user, userCenters, userdata)
                    }
                }
            }
        } catch (error) {
            console.log('Something wrong!', error)
        }
    }
    trackAndInform()
}

bot.command('sendall', async (ctx) => {
    if (ctx.chat.id == SWAPNIL) {
        ctx.scene.enter('send-all')
    } else {
        return await ctx.reply('Sorry this command is for admin only!')
    }
})

bot.command('botstat', async (ctx) => {
    if (ctx.chat.id == SWAPNIL) {
        const users = await User.find({})
        const totalPincodes = users.reduce((count, user) => {
            if (user.tracking.length && user.allowed) {
                count += user.tracking.length
            }
            return count
        }, 0)
        const [{ total: totalSlips }] = await User.aggregate([
            {
                $unwind: "$beneficiaries"
            },
            {
                $project: {
                    sizes: { $size: {
                        $ifNull: ["$beneficiaries.appointments", []]
                    } }
                }
            },
            {
                $group: {
                    _id: "",
                    total: { $sum: "$sizes" }
                }
            }
        ])
        const txt = `Bot Stat!\n<b>Total Users</b>: ${users.length}\n<b>Total pincodes in tracking</b>: ${totalPincodes}\n<b>Logged in users</b>: ${users.filter(u => u.token && u.allowed).length}\n<b>Total Districts(Unique)</b>: ${[...new Set(users.filter(u => u.districtId && u.allowed).map(u => parseInt(u.districtId)))].length}\n<b>Total Districts</b>: ${users.filter(u => !!u.districtId && u.allowed).length}\n<b>Total users with AutoBook</b>: ${users.filter(u => u.autobook == true && u.allowed).length}\n<b>Total Appointments</b>: ${totalSlips}\nTracker sleeptime: ${TRACKER_SLEEP_TIME}ms`
        return await ctx.reply(txt, { parse_mode: 'HTML' })
    }
})

bot.action('yes_booked', async (ctx) => {
    try {
        return await ctx.editMessageText('Congratulations! Thanks for using the bot. Follow me on <a href="https://fb.me/swapnilsoni1999">Facebook</a> if you want to. :)\nYou can /untrack your desired pin if you wish to. If you want to track for another dose then /track to add new pin.\n You can also check your tracking stats using /status\n\nPlease consider donating to this project If you wish to :)\nupi: <code>swapnil.soni12345@okaxis</code>', { parse_mode: 'HTML' })
    } catch (err) {}
})
bot.command('donate', async (ctx) => {
    try {
        return await ctx.reply('Thanks for using the bot. Follow me on <a href="https://fb.me/swapnilsoni1999">Facebook</a> if you want to. :)\nPlease consider donating to this project, it took me full nighters to add features and fix bugs to this bot. Thanks \n\nupi: <code>swapnil.soni12345@okaxis</code>', { parse_mode: 'HTML' })
    } catch (error) {
    }
})

bot.command('locations', inviteMiddle, async (ctx) => {
    try {
        const users = await User.find({ allowed: true })
        const states = await CoWIN.getStates()
        try {
            const stateName = ctx.message.text.split(' ').filter((_, i) => i !== 0).join(' ')
            if (!stateName) throw new Error('Display all states.')
            const { state_name, state_id } = states.find(v => v.state_name == stateName.trim())
            console.log(state_name, stateName.trim(), state_id)
            const districts = await CoWIN.getDistrict(state_id)
            const districtIds = [...new Set(users.filter(u => u.districtId && u.stateId == state_id).map(u => u.districtId))]
            const districtMap = districtIds.reduce((result, districtId) => {
                try {
                    const { district_name } = districts.find(v => v.district_id == districtId)
                    const totalUsers = (users.filter(v => v.districtId == districtId )).length
                    if(totalUsers && !(result.find(v => v.district_name == district_name))) {
                        result.push({ district_name, totalUsers })
                    }
                } catch (err) { }
                return result
            }, []).sort((a, b) => b.totalUsers - a.totalUsers)
            const txt = districtMap.map(o => `<b>${o.district_name}</b>: ${o.totalUsers}`).join('\n')

            return await ctx.reply(txt, { parse_mode: 'HTML' })
        } catch (error) {
            const stateIds = [...new Set(users.filter(u => u.stateId).map(u => u.stateId))]
            const stateMap = stateIds.reduce((result, stateId) => {
                try {
                    const { state_name } = states.find(v => v.state_id == stateId)
                    const totalUsers = (users.filter(v => v.stateId == stateId )).length
                    if (totalUsers && !(result.find(v => v.state_name == state_name))) {
                        result.push({ state_name, totalUsers })
                    }
                } catch (err) { }
                return result
            }, []).sort((a, b) => b.totalUsers - a.totalUsers)
            const txt = stateMap.map(o => `<b>${o.state_name}</b>: ${o.totalUsers}`).join('\n')

            return await ctx.reply(txt + "\n\n You can send /locations StateName to get more info.\neg. /locations Gujarat", { parse_mode: 'HTML' })
        }
    } catch (error) {
        console.log(error)
    }
})

bot.action('not_booked', async (ctx) => {
    try {
        return await ctx.editMessageText(`No worries! You\'re still tracked for your current pincodes and age groups!.\nYou can check stat by /status\nWish you luck for the next time. :)`, { parse_mode: 'HTML' })
    } catch (err) {}
})

bot.command('test', async (ctx) => {
    try {
        const centers = await CoWIN.getCentersByDist(702)
        const center = centers.find(c => c.center_id == 581201)

    } catch (err) {
        console.log(err)
    }
})

trackAndInform()
// set false and wait for 5mins if tracker updates the flag or not
setInterval(() => {
    TRACKER_ALIVE = false
}, 6 * 60 * 1000)
setInterval(() => {
    if (!TRACKER_ALIVE) {
        setTimeout(() => {
            if (!TRACKER_ALIVE) {
                bot.telegram.sendMessage(SWAPNIL, 'ALERT: Tracker dead!')
                setTimeout(() => {
                    if (!TRACKER_ALIVE) {
                        console.log('Starting tracker again...')
                        bot.telegram.sendMessage(SWAPNIL, 'Starting tracker again...')
                        trackAndInform()
                    } else {
                        console.log('Tracker got started again by itself. No need to recall')
                        bot.telegram.sendMessage(SWAPNIL, 'Tracker got started again by itself. No need to recall')
                    }
                }, 4 * 60 * 1000)
            }
        }, 10 * 1000)
    }
}, 10 * 60 * 1000)
setInterval(async () => {
    const users = await User.find({ allowed: true })
    checkTokens(users)
}, 1 * 60 * 1000)

module.exports = bot