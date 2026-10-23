# Created by Joshua Jackson
# Date: 2022-02-15
# File: forwardHistory.py
# Project: forwardHistory
# Version: 0.0.2
#
# Main File to run Import Forwarding History and Prepare Report from Forwarding History
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join('../../scripts/', '.')))

import argparse
import json
# !/usr/local/bin/python3
from datetime import date
from reportTools.createGrowthReport import CreateGrowthReport
from reportTools.createReport import CreateReport
from reportTools.importChannelInfo import importChannelInfo
from reportTools.importForwardingHist import ImportForwardingHistory

parser = argparse.ArgumentParser(description='Import Forward History to DB and Create Report CSV for LND Node',
                                 add_help=False)

parser.add_argument('--lnd', '-l', dest="lnd",
                    help='LND Node Name for RPC Call - If not provided will use entire routing node list',
                    required=False)

parser.add_argument('--network', dest="network", help='LND Network (REGTEST, TESTNET, MAINNET)', required=False)

parser.add_argument('--namespace', '-n', dest="namespace", default="lqwd-lnd", help='LND Node Namespace for RPC Call',
                    required=False)

parser.add_argument('--port', '-p', dest="port", type=int, help='LND Node Port for RPC Call', default=8080,
                    required=False)

parser.add_argument('--rpc', '-r', dest="rpc", action="store_true", help='Use RPC Call for Importing Data',
                    required=False)

parser.add_argument('--skip-import', dest='skip_import', action="store_true",
                    help='If you want to skip importing new data use this flag', required=False)

parser.add_argument('--import-file', dest='import_file',
                    help='Path to Text File of Forwarding History to Import (Use Relative Path to File)',
                    required=False)

parser.add_argument('--channel-rpc', dest='channel_rpc', action="store_true", help='Import Channel Info using RPC call',
                    required=False)

parser.add_argument('--channel-file', dest='channel_file',
                    help='Path to Text File of Active Channels to Import (Use Relative Path to File) - This should be '
                         'added if RPC call is not used',
                    required=False)

parser.add_argument('--start-date', '-s', dest="start_date",
                    help='Start Date for Forward History Report (format: m-d-Y UTC)', default='12-01-2021',
                    required=False)

parser.add_argument('--end-date', '-e', dest="end_date", help='End Date for Forward History Report (format: m-d-Y UTC)',
                    default=date.today().strftime("%m-%d-%Y"), required=False)

parser.add_argument('--report-out', '-o', dest='report_out',
                    help='Specify directory where report is saved (Default to /tools/forwardingHistory/reports)',
                    default=os.path.abspath('.'), required=False)

parser.add_argument('--csv', '-c', dest="csv", action="store_true", help='Create CSV Report for Frowarding History',
                    required=False)

parser.add_argument('--growth-csv', '-g', dest="growth_csv", action="store_true",
                    help='Create CSV Growth Report Week Over Week Stats', required=False)

parser.add_argument('--debug', '-d', dest="debug", help='Debug', action="store_true", required=False)

parser.add_argument('-v', '--version', action='version', version='%(prog)s 0.0.2', help="Program Version")

parser.add_argument('-h', '--help', action='help', default=argparse.SUPPRESS, help='Show args')

# parser.add_argument('--html', dest="html", action="store_true", help='Create HTML Report', required=False)
# parser.add_argument('--template_path', '-t', dest='template',
# default="../../forwardingHistory/fhreport_template.html", help='Path to Template File (Use Relative Path to File)',
# required=False)


args = parser.parse_args()

lnd_nodes = None
lnd_node = None

# Step 1a - Import Forwarding History
if not args.skip_import:

    # check if RPC is to be used or Import File
    if args.rpc:

        importFH = ImportForwardingHistory(args.namespace, args.port, args.network, args.debug)

        # check if LND name is given
        if args.lnd is None:
            if args.debug:
                print(f"LND not specified will run import against all Routing Nodes")

            # get list of lnd nodes
            lnd_nodes = importFH.get_lnd_routing_nodes()
            if len(lnd_nodes) < 1:
                print(f"No Routing Nodes Found")
                sys.exit()

            # loop through all routing nodes
            for lnd_node in lnd_nodes:
                lnd_node = lnd_node[0]
                # run RPC call for given lnd node
                rpc_json_res = importFH.create_rpc_call(lnd_node, "/v1/switch")
                # handle data from forwarding history
                forwarding_history = importFH.handle_forwarding_history_json(rpc_json_res, lnd_node)
                # import forwarding history to DB
                importFH.insert_forwarding_history(forwarding_history)
        else:
            # if lnd node name is not none
            rpc_json_res = importFH.create_rpc_call(args.lnd, "/v1/switch")
            forwarding_history = importFH.handle_forwarding_history_json(rpc_json_res, args.lnd)
            importFH.insert_forwarding_history(forwarding_history)

    # assuming rpc was false import file path must be given
    elif args.import_file is not None:
        importFH = ImportForwardingHistory(args.namespace, args.port, args.network, args.debug)

        if args.debug:
            print(f"RPC not specified using import file path instead")

        # check if lnd node was given (must be given for importfile)
        if args.lnd is None:
            parser.error("--lnd required with --import-file")
            sys.exit()

        # read forwarding history list
        f = open(args.import_file)
        rpc_json_res = json.load(f)
        f.close()

        # insert and handle import file with lnd name
        forwarding_history = importFH.handle_forwarding_history_json(rpc_json_res, args.lnd)
        importFH.insert_forwarding_history(forwarding_history)

    else:
        parser.error("Must use --skip-import or --import-file or --rpc to use tool")
        sys.exit()

# Step 1b - Import Channel Info for Given LND Node
if args.channel_file is not None or args.channel_rpc:
    if args.lnd:
        importChan = importChannelInfo(args.namespace, args.port, args.network, args.debug)
        if args.channel_rpc:
            if args.debug:
                print(f"Channel Info to be Imported using RPC call given LND Name")

        # import channel info with RPC

        else:
            if args.debug:
                print(f"Channel File Given, Import Channl Info with LND Name")

            # import channel info with given file path
            # channel capacity
            f_channels = open(args.channel_file)
            channel_json = json.load(f_channels)
            channel_info_list = importChan.handle_channel_info_json(channel_json, args.lnd)
            importChan.insert_channel_info(channel_info_list)

    else:
        if args.debug:
            print(f"LND Name must be given to complete Channel Info Import")

# Step 2a - Create Forwarding History Report for a Given LND Node
if args.csv:
    report = CreateReport(args.start_date, args.end_date, None, args.csv, False, args.report_out, args.debug)

    if args.lnd is None:

        importFH = ImportForwardingHistory(args.namespace, args.port, args.network, args.debug)
        lnd_nodes_tmp = importFH.get_lnd_routing_nodes()

        if len(lnd_nodes_tmp) < 1:
            print(f"No Routing Nodes Found")
            sys.exit()
            lnd_nodes = []

            for lnd_node in lnd_nodes_tmp:
                lnd_nodes.append(lnd_node[0])

        df, df_chan_age = report.get_forwarding_history_data(lnd_nodes)
        final_df = report.build_dataframe(df, df_chan_age)

    else:

        df, df_chan_age = report.get_forwarding_history_data(lnd_nodes)
        final_df = report.build_dataframe(df, df_chan_age)

        # Step 2b - Create Growth Report for Given LND Node requires data from create report can only run with
        # specified lnd node at this point
        if args.growth_csv and args.lnd is None:
            parser.error("--lnd required with --growth_csv")
            sys.exit()
        else:
            # initialize growth report
            growth_report = CreateGrowthReport(df[:-1], args.lnd, args.report_out, args.debug)

            # get channels info
            final_growth_df = growth_report.build_growth_df()
            growth_report.create_csv(final_growth_df, f"growth-report_{date.today().strftime('%m-%d-%Y_%H:%M:%S')}")
