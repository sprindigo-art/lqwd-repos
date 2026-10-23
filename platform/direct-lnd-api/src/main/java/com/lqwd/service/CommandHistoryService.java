package com.lqwd.service;

import com.lqwd.model.entities.CommandHistory;

import com.lqwd.repository.CommandHistoryRepository;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class CommandHistoryService {

    private final CommandHistoryRepository commandHistoryRepository;



    public void saveCH(String command, String apikey) {
        CommandHistory commandHistory = new CommandHistory(command, apikey);
        commandHistoryRepository.save(commandHistory);

    }

    public Page<CommandHistory> getCommandHistory(String apikey, int currentPage, int size) {
        Pageable pageable = PageRequest.of(currentPage, size);
        Page<CommandHistory> page = commandHistoryRepository.findAllByApikey(apikey,pageable);
        return page;
    }
}
