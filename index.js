const axios = require('axios');

const ethers = require('ethers');

const NETWORK = require('./utils/Config.json');

const ABI = require('./smart-contract/Service.json');

let chainId = null;

let provider = null;

let contract = null;

async function setChain(_chainID) {
	chainId = _chainID;

	provider = new ethers.providers.JsonRpcProvider(NETWORK[chainId].rpc);

	contract = new ethers.Contract(NETWORK[chainId].contract, ABI, provider);
}

function toBool(str) {
	return str === 'true';
}

function toHex(str) {
	var hex = '';
	for (var i = 0; i < str.length; i++) {
		hex += '' + str.charCodeAt(i).toString(16);
	}
	return hex;
}

function hex2a(hexx) {
	var hex = hexx.toString();
	var str = '';
	for (var i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
	return str;
}

function getNetwork(newChainId) {
	if (newChainId) {
		return NETWORK[newChainId];
	}
	return NETWORK[chainId];
}

async function checkAddress(_address) {
	var address = _address.trim();

	if (ethers.utils.isAddress(address)) {
		return ethers.utils.getAddress(address);
	} else {
		return null;
	}
}

async function encodeSubscription(_networkId, _boss, _token, _cost, _initdays = 0) {
	var input_boss = await checkAddress(_boss);
	var input_token = await checkAddress(_token);

	var obj = JSON.stringify({
		network: _networkId,
		boss: input_boss,
		token: input_token,
		cost: _cost,
		initdays: _initdays,
	});

	var hash = toHex(obj) || null;

	return { hash: hash, link: 'https://repa.gg/#/join/' + hash };
}

async function decodeSubscription(_hash) {
	var data = await hex2a(_hash); 
	return JSON.parse(data);
}

async function suggestAllowance(_amount) {
	var data = _amount * 365 * 10;
	return data.toString();
}

async function getTokenPrice(_address) {
	let root = 'api';
	let address = 'WETH';

	if (chainId == 137) {
		root = 'polygon.api';
		address = _address;
	}

	if (chainId == 56) {
		root = 'bsc.api';
		address = _address;
	}

	const response = await axios.get(`https://${root}.0x.org/swap/v1/quote?buyToken=USDT&sellToken=${address}&sellAmount=100000000000000000`);

	return response.data.price;
}

async function getUserTokenData(_token, _user) {
	var input_user = await checkAddress(_user);
	var input_token = await checkAddress(_token);

	if (input_user && input_token) {
		const datax = await contract.userBalance(input_user, input_token);
		const datap = await contract.userAllowance(input_user, input_token);

		return { balance: datax.toString(), allowance: datap.toString() };
	}
}

async function tokenDetails(_token) {
	var input_token = await checkAddress(_token);

	var decimal = await contract.getTokenDecimal(input_token);
	var name = await contract.getTokenName(input_token);
	var symbol = await contract.getTokenSymbol(input_token);

	return {
		decimal: decimal.toString(),
		symbol: symbol.toString(),
		name: name.toString(),
	};
}

async function canUserPay(_hash) {
	const data = await contract.canUserPay(_hash);
	return toBool(data.toString());
}

async function totalIds() {
	const data = await contract.storeLength();
	return data - 1;
}

async function randomSubscription() {
	const max = await totalIds();
	const random = Math.floor(Math.random() * max);

	const sub_hash = await contract.store(random);
	const data = await subscriptions(sub_hash);

	return data;
}

async function hashing(_token, _user, _boss, _cost) {
	const datax = await contract.subscriptionHash(_token, _user, _boss, _cost);
	const datay = await contract.planHash(_token, _boss, _cost);

	return { sub: datax.toString(), plan: datay.toString() };
}

async function subscriptions(_hash) {
	const sub_object = await contract.subscriptions(_hash);
	const aliveDuration = await contract.lastPaid(_hash);
	const pendingInSec = await contract.unpaidSeconds(_hash);
	const pendingInDay = await contract.unpaidDays(_hash);
	const pendingInCost = await contract.unpaidCost(_hash);
	const active = await contract.subscriptionAlive(_hash);

	return {
		sub: sub_object.sub.toString(),
		plan: sub_object.plan.toString(),
		token: sub_object.token.toString(),
		user: sub_object.user.toString(),
		boss: sub_object.boss.toString(),
		cost: sub_object.cost.toString(),
		timestamp: aliveDuration.toString(),
		unpaidInSec: pendingInSec.toString(),
		unpaidInDay: pendingInDay.toString(),
		unpaidInCost: pendingInCost.toString(),
		active: active,
	};
}

async function getSubscriptionsByUser(_user) {
	var input_user = await checkAddress(_user);

	const max = await totalIds();
	const user = [];
	const boss = [];
	const tokens_temp = [];

	for (let index = 0; index < max; index++) {
		const sub_hash = await contract.store(index);

		const subs = await subscriptions(sub_hash);

		if (subs.active) {
			if (subs.user == input_user) {
				user.push(subs.sub);
			}
			if (subs.boss == input_user) {
				boss.push(subs.sub);
				tokens_temp.push(subs.token);
			}
		}
	}

	const tokens = [...new Set(tokens_temp)];

	return { user, boss, tokens };
}

async function randomCollect(address) {
	const data = await axios({
		url: NETWORK[chainId].graph,
		method: 'post',
		data: {
			query: ` 
        {
          subscriptionLists(where : {boss : "${address}" , active :true}) {
            timestamp
            sub
            plan
            active
          }
        
        }
     `,
		},
	}).then((res) => res.data.data.subscriptionLists);

	var random = Math.floor(Math.random() * data.length);

	var rdata = await subscriptions(data[random].sub);

	var cdata = await canUserPay(data[random].sub);

	var userbal = await getUserTokenData(rdata.token, rdata.user);

	var tokenInfo = await tokenDetails(rdata.token);

	return {
		canUserPay: cdata,
		subHash: rdata.sub,
		data: rdata,
		tokenData: userbal,
		tokenInfo: tokenInfo,
	};
}

async function graphSubscriptions(objs, network) {
	let chain = chainId;
	if (network) {
		chain = network;
	}
	const data = await axios({
		url: NETWORK[chain].graph,
		method: 'post',
		data: {
			query: `{ subscriptionLists(orderBy : timestamp, orderDirection : desc, ${objs}) {id active txn timestamp sub plan user boss cost token token_name token_symbol token_decimal } }`,
		},
	}).then((res) => res.data.data.subscriptionLists);

	return data;
}

async function graphTransfers(objs, network) {
	let chain = chainId;
	if (network) {
		chain = network;
	}
	const data = await axios({
		url: NETWORK[chain].graph,
		method: 'post',
		data: {
			query: `{ transferLists(orderBy : timestamp, orderDirection : desc, ${objs}) { id txn sub token plan user boss amount timestamp token_name token_symbol token_decimal token_balance token_allowance } }`,
		},
	}).then((res) => res.data.data.transferLists);

	return data;
}

function trimAddress(address) {
	return `${address.slice(0, 5)}...${address.slice(address.length - 5, address.length)}`;
}

module.exports = {
	setChain,
	checkAddress,
	encodeSubscription,
	decodeSubscription,
	suggestAllowance,
	getTokenPrice,
	getUserTokenData,
	tokenDetails,
	canUserPay,
	totalIds,
	subscriptions,
	getSubscriptionsByUser,
	graphSubscriptions,
	graphTransfers,
	randomSubscription,
	hashing,
	ABI,
	getNetwork,
	randomCollect,
	trimAddress,
};
