/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Message } from "discord.js";
import { randomBytes } from "crypto";

import { REGISTER_TIMEOUT } from "../constants";
import { OnCleanup, assert } from "../common";
import { User, addUser, getUser, getUserByBojId } from "../io/db";
import { existBojId, getSharedSource } from "../io/boj";

const usage = "`!등록 <BOJ ID>`으로 봇에 등록할 수 있습니다.";

const userAlreadyRegistered = (id: string, user: User) => (
	`<@${id}>님은 \`${user.bojId}\`로 이미 봇에 등록되어 있습니다.`
);

const bojIdAlreadyRegistered = (bojId: string) => (
	`\`${bojId}\`는 이미 봇에 등록된 BOJ ID입니다.`
);

const notFound = (bojId: string) => (
	`\`${bojId}\` 백준 아이디가 존재하지 않습니다.`
);

const invalidUrl = `잘못된 링크입니다. 다시 입력해주세요.`;

const cancelled = `등록이 취소되었습니다.`;

const remainTime = (remain: number) => `등록 제한시간: ${(remain / 60000).toFixed(0)}분`;

const registerSuccess = (id: string, bojId: string) => `<@${id}>님이 \`${bojId}\`로 봇에 등록되었습니다.`;

export default {
	command: "등록",
	execute: async(message: Message, onCleanup: OnCleanup) => {
		const { author, content } = message;
		const { id } = author;

		const args = content.split(" ").slice(1);
		assert(args.length === 1, usage);
		const bojId = args[0];

		{
			const user = await getUser(id);
			assert(user === null, userAlreadyRegistered, id, user!);
		}
		{
			const user = await getUserByBojId(bojId);
			assert(user === null, bojIdAlreadyRegistered, id);
		}
		assert(await existBojId(bojId), notFound, bojId);

		const registerToken = `사랑해요 주때봇 ${randomBytes(16).toString("hex")}`;
		const tokenMessage = await message.reply(
			`\`\`\`${registerToken}\`\`\`\n`
			+ `봇에 등록하시려면 위 문구를 임의의 문제에 제출하고, 해당 코드를 공유한 주소를 입력해주세요.\n`
			+ `등록을 취소하려면 ❌ 이모지를 달아주세요.`,
		);


		// 병렬 실행
		const startTime = Date.now();
		const endTime = startTime + REGISTER_TIMEOUT;

		const remainMessage = await message.channel.send(remainTime(endTime - Date.now()));
		const updateRemain = () => {
			const { content } = remainMessage;
			const newContent = remainTime(endTime - Date.now());
			if (content !== newContent) remainMessage.edit(newContent);
		};

		const timer = setInterval(updateRemain, 1000);
		onCleanup(() => clearInterval(timer));

		let end = false;
		onCleanup(() => (end = true));

		await remainMessage.react("❌");
		const cancelPromise = remainMessage.awaitReactions({
			filter: ({ emoji: { name } }, { id }) => name === "❌" && id === author.id,
			max: 1,
			time: endTime - Date.now(),
		}).then(() => false);

		const registerPromise = (async() => {
			while (Date.now() < endTime) {
				// eslint-disable-next-line no-await-in-loop
				const messages = await message.channel.awaitMessages({
					filter: ({ content, author: { id } }) => content.startsWith("http") && id === author.id,
					max: 1,
					time: endTime - Date.now(),
				});
				const sourceMessage = messages.first();
				if (end || sourceMessage === undefined) break;
				// eslint-disable-next-line no-await-in-loop
				const source = await getSharedSource(sourceMessage.content);
				if (source !== null && source.bojId === bojId && source.content === registerToken) return true;
				sourceMessage.reply(invalidUrl);
			}
			return false;
		})();

		const result = await Promise.race([cancelPromise, registerPromise]);
		if (!result) {
			await tokenMessage.reply(cancelled);
			return;
		}

		// 등록

		await addUser(id, bojId);
		await tokenMessage.reply(registerSuccess(id, bojId));
	},
};
