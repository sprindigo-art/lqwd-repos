import sys, getopt
from spring_config import ClientConfigurationBuilder
from spring_config.client import SpringConfigClient

def getConfig(address, profile):
    config = (
        ClientConfigurationBuilder()
        .app_name("frontend")
        .address(address)
        .authentication(("", ""))
        .profile(profile)
        .branch("develop")

        .build()
    )
    #[08:36] Christian Okeme
    # Fetch from http://someserver.com using profile "development"config = (ClientConfigurationBuilder().app_name("test-application").address("http://someserver.com").build())# Fetch from http://someserver.com using profile "production"config = (ClientConfigurationBuilder().app_name("test-application").address("http://someserver.com").profile("production").build())




    try:
        c = SpringConfigClient(config)
    except Exception as e:
        print("Spring connection error: " +str(e))
        sys.exit(2)
    return c.get_config()



def main(argv):
    address = ''
    profile = ''
    scenario = ''
    try:
        opts, args = getopt.getopt(argv,"ha:p:s:",["address=","profile=","scenario="])
    except getopt.GetoptError:
        print(' -a <address for config server> -p <profile> -s <scenario>')
        sys.exit(2)
    for opt, arg in opts:
        if opt == '-h':
            print (' -a <address for config server> -p <profile> -s <scenario>')
            sys.exit()
        elif opt in ("-a", "--address"):
            address = arg
        elif opt in ("-p", "--profile"):
            profile = arg
        elif opt in ("-s", "--scenario"):
            scenario = arg

    # read config
    config=getConfig(address, profile)

    print(config)

if __name__ == "__main__":
    main(sys.argv[1:])
