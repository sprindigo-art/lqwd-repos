package com.lqwd.validators;

import com.lqwd.config.AppProperties;
import com.lqwd.exceptions.LndRequestValidationException;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class LndRequestValidator {
    private final static Logger logger = LoggerFactory.getLogger(LndRequestValidator.class);

    private final AppProperties properties;


    public  void validate(String command, Optional<Map<String, Object>> data){
        switch (command){
            case "v1/channels":
                validateOpenChannelRequest(data);
                break;
        }
    }

    public void validateOpenChannelRequest(Optional<Map<String, Object>> data){
        logger.info("validating lnd open channel request ");
        if(data.isPresent()){
            Map<String,Object> params = data.get();
            if(!params.containsKey("local_funding_amount")){
                throw new LndRequestValidationException("Please provide local_funding_amount for opening channel");
            }
            if(!params.containsKey("node_pubkey_string")){
                throw new LndRequestValidationException("Please provide node_pubkey_string for opening channel");
            }
            int channelSize = Integer.parseInt(params.get("local_funding_amount").toString());
            if(channelSize < properties.getLnd_min_channel_size()){
                throw new LndRequestValidationException("Invalid value for  local_funding_amount. Should be >= "+properties.getLnd_min_channel_size());
            }
        }else{
            throw new LndRequestValidationException("Please provide required params for opening channel");
        }
    }
}
