const BOT_TOKEN = 'token robot';
const ADMINS = ["admin1, admin2"];// ID admin ha bedone @
const BOT_ID = "";// ID robot bedone @

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const botValues = env.bot_values_link;
    const botDB = env.dblink;

    async function postReq(url, fields) {
      const tgFormData = new FormData();
      fields.forEach(obj => {
        for (let key in obj) {
          tgFormData.append(key, obj[key]);
        }
      });
      const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${url}`, {
        method: 'POST',
        body: tgFormData,
      });
      return await telegramResponse;
    }

    async function deleteAfterDelay(chatId, messageId, delayMs = 20000) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      try {
        await postReq(`deleteMessage`, [
          { "chat_id": chatId },
          { "message_id": messageId }
        ]);
      } catch (error) {
        console.error(`Failed to delete message: ${error.message}`);
      }
    }

    // Initialize webhook
    if (url.pathname === "/init") {
      try {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        const webhookkey = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        await botValues.put("webhookkey", webhookkey);

        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: `${url.protocol}//${url.hostname}/hook/${webhookkey}`
          })
        });

        const result = await response.json();
        if (result.ok) {
          return new Response("Webhook successfully set!", { status: 200 });
        } else {
          return new Response(`Failed to set webhook: ${result.description}`, { status: 400 });
        }
      } catch (error) {
        return new Response(`Error setting webhook: ${error.message}`, { status: 500 });
      }
    }

    // Handle webhook requests
    if (url.pathname.startsWith("/hook")) {
      const reqHook = url.pathname.split('/hook/')[1];

      if (reqHook == await botValues.get("webhookkey")) {
        if (request.method === "POST") {
          try {
            const body = await request.json();

            // تابع بهبود یافته برای بررسی عضویت
            async function checkMember(chatId, postid) {
              const requestPost = await botDB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(postid).first();

              const channels = requestPost.channels.trim().split('\n').map(line => {
                const [id, ...titleParts] = line.split(' ');
                return { id, title: titleParts.join(' ') };
              });

              let isMember = [];
              for (const channel of channels) {
                try {
                  const check_member = await postReq(`getChatMember`, [
                    { "chat_id": channel.id },
                    { "user_id": chatId }
                  ]);
                  const check_member_json = await check_member.json();

                  if (check_member_json.result.status == "member" || check_member_json.result.status == "creator") {
                    isMember.push(channel.id);
                  }
                } catch (e) {}
              }

              let result = false;
              if (channels.length > 0 && channels.length == isMember.length) {
                // ارسال تمام فایل‌های مرتبط با پست
                const postCaption = JSON.parse(requestPost.caption);
                
                if (postCaption.type === 'multiple_files') {
                  for (const file of postCaption.files) {
                    const sentFile = await postReq(`copyMessage`, [
                      { "chat_id": chatId },
                      { "from_chat_id": requestPost.from_chat_id },
                      { "message_id": file.message_id }
                    ]);
                    
                    const sentFileJson = await sentFile.json();
                    if (sentFileJson.ok) {
                      ctx.waitUntil(deleteAfterDelay(chatId, sentFileJson.result.message_id));
                    }
                  }
                } else {
                  // ارسال تک فایل (برای سازگاری با پست‌های قدیمی)
                  const sentFile = await postReq(`copyMessage`, [
                    { "chat_id": chatId },
                    { "from_chat_id": requestPost.from_chat_id },
                    { "message_id": requestPost.message_id }
                  ]);
                  
                  const sentFileJson = await sentFile.json();
                  if (sentFileJson.ok) {
                    ctx.waitUntil(deleteAfterDelay(chatId, sentFileJson.result.message_id));
                  }
                }

                try {
                  await postReq(`deleteMessage`, [
                    { "chat_id": chatId },
                    { "message_id": await botValues.get("registerMsg_" + chatId) }
                  ]);
                } catch (e) {}
                result = true;
              } else {
                const mustJoin = [];
                for (const channel of channels) {
                  if (!isMember.includes(channel.id)) {
                    mustJoin.push([{
                      "text": channel.title,
                      "url": `https://t.me/${channel.id.replace(/^@+/, '')}`
                    }]);
                  }
                }

                mustJoin.push([{
                  "text": "✅ عضو شدم بررسی",
                  "callback_data": postid
                }]);

                const mustJoinBtns = JSON.stringify({
                  "inline_keyboard": mustJoin
                });

                let registerMsgSent = true;

                if (await botValues.get("registerMsg_" + chatId)) {
                  const editMessageResponse = await postReq(`editMessageReplyMarkup`, [
                    { "chat_id": chatId },
                    { "message_id": await botValues.get("registerMsg_" + chatId) },
                    { "reply_markup": mustJoinBtns }
                  ]);

                  const editMessageResponseJson = await editMessageResponse.json();

                  if (!editMessageResponseJson.ok && editMessageResponseJson.description.toLowerCase().includes("not found")) {
                    registerMsgSent = false;
                  }
                } else {
                  registerMsgSent = false;
                }

                if (!registerMsgSent) {
                  const postCaption = JSON.parse(requestPost.caption);
                  let registerMsg = null;
                  const start_cap = "برای دریافت این باید در همه ی کانال های زیر 👇 عضو بشی و روی بررسی کلیک کنی";

                  if (postCaption.type == 'text') {
                    registerMsg = await postReq(`sendMessage`, [
                      { "chat_id": chatId },
                      { "text": postCaption.text+"\n\n"+start_cap },
                      { "reply_markup": mustJoinBtns }
                    ]);
                  } else if (postCaption.type === 'multiple_files') {
                    registerMsg = await postReq(`sendMessage`, [
                      { "chat_id": chatId },
                      { "text": postCaption.description+"\n\n"+start_cap },
                      { "reply_markup": mustJoinBtns }
                    ]);
                  } else {
                    registerMsg = await postReq(`copyMessage`, [
                      { "chat_id": chatId },
                      { "from_chat_id": requestPost.from_chat_id },
                      { "message_id": postCaption.message_id },
                      { "caption": postCaption.text+"\n\n"+start_cap},
                      { "reply_markup": mustJoinBtns }
                    ]);
                  }

                  const registerMsgJson = await registerMsg.json();
                  await botValues.put("registerMsg_" + chatId, registerMsgJson.result.message_id);
                }
              }
              return result;
            }

            // Handle callback queries
            if (body.callback_query) {
              const callbackQuery = body.callback_query;
              const is_registerd = await checkMember(callbackQuery.message.chat.id, callbackQuery.data);

              if (!is_registerd) {
                await postReq(`answerCallbackQuery`, [
                  { "callback_query_id": callbackQuery.id },
                  { "text": "هنوز تو همشون عضو نشدی 🫤" },
                  { "show_alert": true },
                ]);
              } else {
                await postReq(`answerCallbackQuery`, [
                  { "callback_query_id": callbackQuery.id }
                ]);
              }
            }

            // Handle messages
            if (body.message) {
              const chatId = body.message.chat.id;

              if (ADMINS.includes(body.message.chat.username)) {
                await postReq(`setMyCommands`, [
                  {
                    "scope": JSON.stringify({
                      type: 'chat',
                      chat_id: chatId
                    })
                  },
                  { "commands": JSON.stringify([
                    { command: '/newpost', description: 'پست جدید' },
                    { command: '/addfile', description: 'افزودن فایل به پست' }
                  ]) }
                ]);

                const setAct = async (act) => {
                  await botValues.put("action_" + chatId, JSON.stringify(act));
                };

                const getAct = async () => {
                  const act = await botValues.get("action_" + chatId);
                  return act ? JSON.parse(act) : null;
                };

                // Handle /newpost command
                if (body.message.text == '/newpost') {
                  await postReq(`sendMessage`, [
                    { "chat_id": chatId },
                    { "text": "یک پیام، فایل یا مجموعه فایل‌ها را ارسال کنید" },
                  ]);
                  await setAct({ "act": "wait_for_post", "files": [] });
                } 
                // Handle /addfile command
                else if (body.message.text == '/addfile') {
                  const currentAct = await getAct();
                  if (currentAct && currentAct.act === "wait_for_more_files") {
                    await postReq(`sendMessage`, [
                      { "chat_id": chatId },
                      { "text": "فایل بعدی را ارسال کنید یا برای اتمام /done را ارسال کنید" },
                    ]);
                  } else {
                    await postReq(`sendMessage`, [
                      { "chat_id": chatId },
                      { "text": "ابتدا باید یک پست جدید ایجاد کنید (/newpost)" },
                    ]);
                  }
                }
                // Handle /done command
                else if (body.message.text == '/done') {
                  const currentAct = await getAct();
                  if (currentAct && currentAct.act === "wait_for_more_files") {
                    await postReq(`sendMessage`, [
                      { "chat_id": chatId },
                      { "text": "کانال‌های عضو اجباری را وارد کنید\nبه این صورت:\n\n@IdChannel title1\n@IdChannel title2" },
                    ]);
                    currentAct.act = "wait_for_channels";
                    await setAct(currentAct);
                  }
                }
                // Handle admin messages
                else if (('text' in body.message && !body.message.text.startsWith("/start")) || !('text' in body.message)) {
                  const currentAct = await getAct();

                  if (currentAct) {
                    if (currentAct.act == "wait_for_post") {
                      if ('text' in body.message) {
                        // Text post
                        currentAct.type = "text";
                        currentAct.text = body.message.text;
                        currentAct.act = "wait_for_channels";
                        await setAct(currentAct);

                        await postReq(`sendMessage`, [
                          { "chat_id": chatId },
                          { "text": "کانال‌های عضو اجباری را وارد کنید\nبه این صورت:\n\n@IdChannel title1\n@IdChannel title2" },
                        ]);
                      } else {
                        // File post
                        currentAct.files.push({
                          message_id: body.message.message_id,
                          type: body.message.document ? 'document' : 
                                body.message.photo ? 'photo' : 
                                body.message.video ? 'video' : 
                                body.message.audio ? 'audio' : 'file'
                        });
                        
                        if (currentAct.files.length === 1) {
                          // First file - ask for more or proceed
                          await postReq(`sendMessage`, [
                            { "chat_id": chatId },
                            { "text": "فایل اول ذخیره شد. می‌توانید فایل‌های بیشتری ارسال کنید یا /done را برای ادامه بزنید" },
                          ]);
                          currentAct.act = "wait_for_more_files";
                          await setAct(currentAct);
                        }
                      }
                    } 
                    else if (currentAct.act == "wait_for_more_files") {
                      // Add more files to the post
                      currentAct.files.push({
                        message_id: body.message.message_id,
                        type: body.message.document ? 'document' : 
                              body.message.photo ? 'photo' : 
                              body.message.video ? 'video' : 
                              body.message.audio ? 'audio' : 'file'
                      });
                      
                      await postReq(`sendMessage`, [
                        { "chat_id": chatId },
                        { "text": `فایل ${currentAct.files.length} ذخیره شد. فایل دیگری ارسال کنید یا /done را بزنید` },
                      ]);
                      await setAct(currentAct);
                    }
                    else if (currentAct.act == "wait_for_channels") {
                      await postReq(`sendMessage`, [
                        { "chat_id": chatId },
                        { "text": "عنوان را وارد کنید" },
                      ]);

                      currentAct.channels = body.message.text;
                      currentAct.act = "wait_for_caption";
                      await setAct(currentAct);
                    } 
                    else if (currentAct.act == "wait_for_caption") {
                      let caption = {};

                      if (currentAct.type === "text") {
                        caption = {
                          type: "text",
                          text: currentAct.text
                        };
                      } else if (currentAct.files.length === 1) {
                        // Single file post
                        const file = currentAct.files[0];
                        if ('caption' in body.message) {
                          caption = {
                            type: "file_with_caption",
                            message_id: file.message_id,
                            text: body.message.text || body.message.caption
                          };
                        } else {
                          caption = {
                            type: "file_without_caption",
                            message_id: file.message_id,
                            text: body.message.text || ""
                          };
                        }
                      } else {
                        // Multiple files post
                        caption = {
                          type: "multiple_files",
                          description: body.message.text || "لطفا در کانال‌های زیر عضو شوید",
                          files: currentAct.files
                        };
                      }

                      const insertNewPost = await botDB.prepare(
                        `INSERT INTO posts (message_id, from_chat_id, channels, caption) VALUES (?1, ?2, ?3, ?4)`
                      ).bind(
                        currentAct.files.length > 0 ? String(currentAct.files[0].message_id) : "0",
                        String(chatId),
                        String(currentAct.channels),
                        String(JSON.stringify(caption)),
                      ).run();

                      const postCaption = "برای دریافت باید عضو " + (body.message.text || "کانال‌های مشخص شده") + " شوید";

                      const buyBtn = JSON.stringify({
                        "inline_keyboard": [
                          [
                            {
                              "text": "دریافت فایل‌ها",
                              "url": `https://t.me/${BOT_ID}?start=${insertNewPost.meta.last_row_id}`
                            }
                          ]
                        ]
                      });

                      if (currentAct.files.length > 0) {
                        // Send first file with button
                        await postReq(`copyMessage`, [
                          { "chat_id": chatId },
                          { "from_chat_id": chatId },
                          { "message_id": currentAct.files[0].message_id },
                          { "caption": postCaption },
                          { "reply_markup": buyBtn }
                        ]);
                      } else {
                        // Text post
                        await postReq(`sendMessage`, [
                          { "chat_id": chatId },
                          { "text": postCaption },
                          { "reply_markup": buyBtn }
                        ]);
                      }

                      await setAct({ "act": "idle" });
                    }
                  }
                }
              }

              // Handle /start command
              if (body.message.text.startsWith("/start")) {
                const postid = body.message.text.match(/\/start (\w+)/)?.[1];
                if (postid) {
                  await botValues.put("registerMsg_" + chatId, "");
                  await checkMember(chatId, postid);
                }
              }
            }
          } catch (e) {
            console.error("Error handling update:", e);
          }
        }
        return new Response("", { status: 200 });
      } else {
        return new Response("wrong webhook", { status: 200 });
      }
    }

    return new Response("ok", { status: 200 });
  }
};
