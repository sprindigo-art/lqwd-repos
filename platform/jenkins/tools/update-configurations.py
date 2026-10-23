import jenkins
import json
import sys, getopt
import xml.etree.ElementTree as ET
#to make code work with expired certificate
import os
os.environ.setdefault("PYTHONHTTPSVERIFY","0")
 
# Read command line args
try:
    myopts, args = getopt.getopt(sys.argv[1:],"u:p:")
    for o, a in myopts:
        if o == '-u':
            username=a
        elif o == '-p':
            password=a
        else:
            print("Usage: %s -u username -p password" % sys.argv[0])
except:
    print("Usage: %s -u username -p password" % sys.argv[0])
    quit()

baseurl = 'https://jenkins.lqwd.tech/'

server = jenkins.Jenkins(baseurl, username, password)
user = server.get_whoami()
version = server.get_version()
print('Hello %s from Jenkins %s' % (user['fullName'], version))

## assuming we have only two level (jobs=>subjobs)
jobs = server.get_jobs()
for job in jobs:
    #print server.get_job_config(job["name"])
    pipeline_folder = os.path.join( os.path.dirname( __file__ ), '..','configurations',job["name"])
    if not os.path.exists(pipeline_folder):
      os.makedirs(pipeline_folder)
    for subjob in job["jobs"]:
      print job["name"] + "/" +subjob["name"]
      xmlname = os.path.join( pipeline_folder, subjob["name"] + '.xml')
      jsonname = os.path.join( pipeline_folder,subjob["name"] + '_Jenkinsfile')
      #
      xmlconfig = server.get_job_config(job["name"] + "/" +subjob["name"])
      xmlfile = open(xmlname, "a")
      xmlfile.write(xmlconfig)
      xmlfile.close()
      #
      root_node = ET.ElementTree(ET.fromstring(xmlconfig)).getroot()
      script_node = root_node.find('definition/script')
      if script_node is not None: 
          jsonConfig = script_node.text
          jsonfile = open(jsonname, "a")
          jsonfile.write(jsonConfig)
          jsonfile.close()
