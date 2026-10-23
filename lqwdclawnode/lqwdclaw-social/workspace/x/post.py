import sys
import argparse
from x_client import post_tweet

parser = argparse.ArgumentParser(description="Post a tweet to X")
parser.add_argument("--reply-to", type=str, help="Tweet ID to reply to", default=None)
parser.add_argument("text", type=str, help="Tweet text")
args = parser.parse_args()

result = post_tweet(args.text, reply_to=args.reply_to)
print(result)
