# Created by Joshua Jackson
# Date: 2022-09-01
# File: config_sample.py
# Project: scripts
# Version:
#
# Summary
class Config:
	host = "db host"
	port = "db port"
	dbname = "db name"
	username = "db username"
	password = "db password"
	
	# For Twilio SMS Notification Use
	twilio_account_sid = ""
	twilio_service_sid = ""
	twilio_auth_token = ""
	
	# For AWS SNS service use
	aws_topic = ""
	aws_key = ""
	aws_secret = ""
