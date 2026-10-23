package com.lqwd.service;

import com.lqwd.model.entities.LndInteraction;
import com.lqwd.repository.LndInteractionRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class LndInteractionService {

    private static final Logger logger = LoggerFactory.getLogger(LndInteractionService.class);

    private final LndInteractionRepository lndInteractionRepository;


    public LndInteraction save(LndInteraction interaction){
        return lndInteractionRepository.save(interaction);
    }

    public LndInteraction logLndInteraction(LndInteraction interaction){

        logger.info("lnd transaction: command = {}, node = {}, Request = {}, Response = {}",
                interaction.getAction(), interaction.getNodeName(),interaction.getRequest(),interaction.getResponse());

       return save(interaction);

    }


    public void delete(Long interactionId){
        lndInteractionRepository.deleteById(interactionId);
    }

}
