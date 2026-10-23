import os

class Config:
    dbhost = os.getenv("STAT_HOST")
    dbport = os.getenv("STAT_PORT")
    dbname = os.getenv("STAT_DB")
    dbuser = os.getenv("STAT_USER")
    dbpassword = os.getenv("STAT_PASS")
    
    routingDB = os.getenv("ROUTING_DB")
    routingUser = os.getenv("ROUTING_USER")
    routingPass = os.getenv("ROUTING_PASS")
    routingHost = os.getenv("ROUTING_HOST")
    routingPort = os.getenv("ROUTING_PORT")
    coinmarket_cap_api = os.getenv("COINMARKETCAPAPI")