

import os
import subprocess

debug = True

api_key = "b9ea5e68c7b42d4a045df2cea58d54cd11e98315e75a9291085775f97311d3e3dcc94b6ae976db8d3eb4cf2c50fa1d7f9b564a93347de680acc78b92d85fcef8"

endpoints = [
	["v1/channels", "GET"],
	["v1/balance/blockchain", "GET"],
	["v1/balance/channels", "GET"],
	["v1/balance/channels/pending", "GET"],
	["v1/fees",  "GET"],
	["v1/getinfo",  "GET"],
	["v1/getrecoveryinfo",  "GET"], 
]


command = "curl"
header = "--header" 
pubkey = "pubkey:" + api_key 
request = "--request"

for endpoint in endpoints :
	host = "http://192.168.123.252:8690/lnd/" + endpoint[0]
	rtype = endpoint[1]

	call = command + " " + header + " " + pubkey + " " + request + " " + rtype + " " +host

	if (debug): 
		print ("COMMAND: ", command)
		print ("HEADER: ", header)
		print ("HOST: ", host)
		print ("ENDPOINT: ", endpoint[0])
		print ("RTYPE: ", rtype)
		print ("CALL: ", call)

	#reply = os.system(command)
	reply = subprocess.run([command, header, pubkey, request, rtype, host ])

	print("\nREPLY: ", reply)
	print("============================================================================")
