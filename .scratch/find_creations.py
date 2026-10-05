import json, sys, time, urllib.request
net=sys.argv[1]; R={"mainnet":"https://rpc.hyperliquid.xyz/evm","testnet":"https://rpc.hyperliquid-testnet.xyz/evm"}[net]
def rpc(m,p):
    req=urllib.request.Request(R,data=json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),headers={"content-type":"application/json"})
    return json.load(urllib.request.urlopen(req,timeout=20))
head=int(rpc("eth_blockNumber",[])["result"],16)
found=[]
for i in range(0,400):
    b=head-200000-i*11   # well in the past so the probe has old blocks on both sides
    r=rpc("eth_getBlockReceipts",[hex(b)])
    if "error" in r: print("err",r["error"]); time.sleep(3); continue
    for rc in r["result"] or []:
        if rc.get("contractAddress"):
            found.append((b, rc["contractAddress"], rc["transactionHash"]))
    if len(found)>=2: break
    time.sleep(0.7)
print(net, head, found[:3])
