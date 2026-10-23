# Created by Joshua Jackson
# Date: 2022-01-24
# File: forwardHistory.py
# Project: forwardHistory
# Version: 0.0.1
#
# Main File to run Import Forwarding History and Prepare Report from Forwarding History

import argparse
import json
# !/usr/local/bin/python3
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

from datetime import date
from forwardHistory.importForwardingHist import importForwardingHistory
from forwardHistory.prepare_report import PrepareReport

parser = argparse.ArgumentParser(description='Import Forward History to DB and Create Report CSV for LND Node', add_help=False)

parser.add_argument('--lnd', '-l', dest="lnd", help='LND Node Name for RPC Call - If not provided will use entire routing node list', required=False)

parser.add_argument('--network', dest="network", help='LND Network (REGTEST, TESTNET, MAINNET)', required=False)

parser.add_argument('--namespace', '-n', dest="namespace", default="lqwd-lnd", help='LND Node Namespace for RPC Call', required=False)

parser.add_argument('--port', '-p', dest="port", type=int, help='LND Node Port for RPC Call', default=8080, required=False)

parser.add_argument('--start_date', '-s', dest="start_date", help='Start Date for Forward History Report (format: m-d-Y UTC)', default='12-01-2021', required=False)

parser.add_argument('--end_date', '-e', dest="end_date", help='End Date for Forward History Report (format: m-d-Y UTC)', default=date.today().strftime("%m-%d-%Y"), required=False)

parser.add_argument('--template_path', '-t', dest='template', default="../../forwardingHistory/fhreport_template.html", help='Path to Template File (Use Relative Path to File)', required=False)

parser.add_argument('--rpc', '-r', dest="rpc", action="store_true", help='Use RPC Call', required=False)

parser.add_argument('--import-file', dest='import_file', help='Path to Text File of Forwarding History to Import (Use Relative Path to File) - This is required ', required=False)

parser.add_argument('--skip-import', dest='skip_import', action="store_true", help='If you want to skip importing new data use this flag', required=False)

parser.add_argument('--report-out', '-o', dest='report_out', help='Specify directory where report is saved (Default to ~)', default=os.path.expanduser("~"), required=False)

parser.add_argument('--csv', '-c', dest="csv", action="store_true", help='Create CSV Report', required=False)

parser.add_argument('--html', dest="html", action="store_true", help='Create HTML Report', required=False)

parser.add_argument('--debug', '-d', dest="debug", help='Debug', action="store_true", required=False)

parser.add_argument('-v', '--version', action='version', version='%(prog)s 0.0.1', help="Program Version")

parser.add_argument('-h', '--help', action='help', default=argparse.SUPPRESS, help='Show args')

args = parser.parse_args()

lnd_nodes = None
lnd_node = None

if not args.skip_import:
	if not args.rpc and args.import_file is None:
		parser.error("--import-file required if no --rpc is added")
	
	importFH = importForwardingHistory(args.namespace, args.port, args.network, args.debug)
	
	#if rpc or importfile is true but lnd is blank
	if args.rpc and args.lnd is None:
		if args.debug:
			print(f"LND not specified will run import against all Routing Nodes")
		
		#get list of lnd nodes
		lnd_nodes = importFH.getLndRoutingNodes()
		if len(lnd_nodes) < 1:
			print(f"No Routing Nodes Found")
			sys.exit()
		
		#if rpc was true
		for lnd_node in lnd_nodes:
			lnd_node = lnd_node[0]
			#run RPC call for given lnd node
			rpc_json_res = importFH.create_rpc_call(lnd_node, "/v1/switch")
			#handle data from forwarding history
			forwarding_history = importFH.handle_forwarding_history_json(rpc_json_res, lnd_node)
			#import forwarding history to DB
			importFH.insert_forwarding_history(forwarding_history)
					
	#if import file was given
	elif args.import_file is not None and args.lnd is not None:
		f = open(args.import_file)
		rpc_json_res = json.load(f)
		forwarding_history = importFH.handle_forwarding_history_json(rpc_json_res, args.lnd)
		importFH.insert_forwarding_history(forwarding_history)
			
	elif args.lnd is None and args.import_file is None and args.rpc is False:
			print(f"Must specify atleast LND name and RPC true or LND name and import file path or just RPC true")
			sys.exit()
	else:
		rpc_json_res = importFH.create_rpc_call(args.lnd, "/v1/switch")
		forwarding_history = importFH.handle_forwarding_history_json(rpc_json_res, args.lnd)
		importFH.insert_forwarding_history(forwarding_history)
		
if args.csv is True or args.html is True:
	pr = PrepareReport(args.start_date, args.end_date, args.template, args.csv, args.html, args.report_out, args.debug)
	if args.lnd is None:
		importFH = importForwardingHistory(args.namespace, args.port, args.network, args.debug)
		lnd_nodes_tmp = importFH.getLndRoutingNodes()
		if len(lnd_nodes_tmp) < 1:
			print(f"No Routing Nodes Found")
			sys.exit()
		lnd_nodes = []
		for lnd_node in lnd_nodes_tmp:
			lnd_nodes.append(lnd_node[0])
			
		df = pr.get_forwarding_history_data(lnd_nodes)
		
	else:
		df = pr.get_forwarding_history_data(args.lnd)

	if args.html is True:
		pr.create_forwarding_history_report(df)
