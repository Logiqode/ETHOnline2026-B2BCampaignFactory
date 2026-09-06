import { test, expect } from 'bun:test'
import { encodeFunctionData } from 'viem'

test('payload shape', () => {
	let captured: any = null
	const donRuntime = {
		callCapability: (params: any) => {
			captured = params
			return { result: () => ({ data: new Uint8Array(160) }) }
		},
	}
	const sdk = require('@chainlink/cre-sdk')
	const client = new sdk.capabilities.EVMClient(84532n)
	const abi = [{ name: 'campaigns', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: 'escrow', type: 'address' }] }] as any
	const callData = encodeFunctionData({ abi, functionName: 'campaigns', args: [1n] })
	const fakeRuntime: any = { callCapability: donRuntime.callCapability, log: () => {}, config: {} }
	client.callContract(fakeRuntime, {
		call: sdk.encodeCallMsg({ from: '0x0000000000000000000000000000000000000000', to: '0xa9198fD3D9e48Ee8cDc7e70AC6F1BE9547De517F', data: callData }),
	}).result()
	expect(captured).toBeDefined()
	console.log('KEYS:' + Object.keys(captured).join('|'))
	console.log('PAYLOADTYPE:' + typeof captured.payload)
	if (captured.payload?.call) console.log('CALL.TO-LEN:' + captured.payload.call.to?.length)
})
