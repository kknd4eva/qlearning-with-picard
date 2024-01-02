var agentSettings = {
    learningRate: 0.1,
    discountFactor: 0.9,
    explorationRate: 1.0,
    explorationDecay: 0.001
};

var config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#4c6d5e',
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    physics: {
        default: 'arcade',
        arcade: {
            debug: false
        }
    }
};

var agent;
var goal;
var qTable;
var learningRate = 0.1;
var discountFactor = 0.9;
var explorationRate = 1.0;
var explorationDecay = 0.001;
var agentPosition = { x: 0, y: 7 }; // Initial position of the agent
var goalPosition = { x: 7, y: 0 }; // Position of the goal
var gridSize = 8;
var tileSize = 75; // Adjusted to fit within the game's dimensions
var attempt = 1;
var attemptText;
var rewardText;
var totalReward = 0;
var stepDelay = 30; // Delay in milliseconds between each step
var lastStepTime = 0;
var lastAction = null; // Track the last action taken
var epsilonMin = 0.01; // Minimum value for epsilon
var epsilonDecay = 0.995; // Decay rate for epsilon
var obstacles; 

// Add a penalty for revisiting the same state
var penaltyForRevisiting = -0.95;
var lastPosition = null;
var samePositionCount = 0;
var rewardHistory = []; // Array to track the reward history
var rewardChart; // Chart.js chart instance

// couple of extra bits for tracking when our model seems to maximise its reward (game won)
var consecutiveMaxRewardCount = 0;
var maxPossibleReward = 0.86;
var lastReward = 0;



function startGame() {
    // Fetch settings from HTML inputs
    agentSettings.learningRate = parseFloat(document.getElementById('learningRate').value);
    agentSettings.discountFactor = parseFloat(document.getElementById('discountFactor').value);
    agentSettings.explorationRate = parseFloat(document.getElementById('explorationRate').value);
    agentSettings.explorationDecay = parseFloat(document.getElementById('explorationDecay').value);

    // Initialize the Phaser game
    game = new Phaser.Game(config);
}

function showWinMessage(totalAttempts) {
    // Display a winning message
    alert(`Congratulations! The game has been won in ${totalAttempts} attempts.`);

    // Offer to reset the game
    if (confirm("Would you like to reset the game?")) {
        resetGame();
    }
}

function resetGame() {
    location.reload();
}

function preload() {
    this.load.image('agent', 'assets/agent.png');
    this.load.image('goal', 'assets/goal.png');
    this.load.image('obstacle', 'assets/obstacle.png');
}

function create() {
    // Create my qtable which is gridSize x gridSize x 4 (the 4 is the number of actions)
    qTable = Array(gridSize).fill().map(() => Array(gridSize).fill().map(() => Array(4).fill(0)));
    agent = this.physics.add.sprite(agentPosition.x * tileSize, agentPosition.y * tileSize, 'agent').setOrigin(0);
    goal = this.add.sprite(goalPosition.x * tileSize, goalPosition.y * tileSize, 'goal').setOrigin(0);
    attemptText = this.add.text(16, 16, 'Attempt: 1', { fontSize: '32px', fill: '#FFF' });
    rewardText = this.add.text(16, 48, 'Reward: 0', { fontSize: '32px', fill: '#FFF' });
    createObstacles(this);
    params = this.add.text(16, 80, 'Learning Rate: ' + agentSettings.learningRate + '\nDiscount Factor: ' + agentSettings.discountFactor + '\nExploration Rate: ' + agentSettings.explorationRate + '\nExploration Decay: ' + agentSettings.explorationDecay, { fontSize: '16px', fill: '#FFF' });
    var ctx = document.getElementById('rewardChart').getContext('2d');
    rewardChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], // Attempt numbers will be set as labels
            datasets: [{
                label: 'Total Reward per Attempt',
                data: [], // Reward data will be set here
                fill: false,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function createObstacles(scene) {
    obstacles = [];
    // Define fixed positions for the obstacles
    const fixedPositions = [
        { x: 5, y: 2 }, 
        { x: 5, y: 6 }, 
        { x: 2, y: 5 }, 
        { x: 1, y: 5 }  
    ];

    fixedPositions.forEach(pos => {
        const obstacle = scene.add.sprite(pos.x * tileSize, pos.y * tileSize, 'obstacle').setOrigin(0);
        obstacles.push(obstacle);
    });
}

// Function to update the last few actions taken
var pastActions = []; // Array to store past actions
function updateLastActions(action) {
    pastActions.unshift(action); // Add the new action to the beginning of the array
    if (pastActions.length > 3) { // Limit the size of the array to 3
        pastActions.pop(); // Remove the oldest action
    }
}

// Function to get the last few actions to avoid
function lastActions() {
    return pastActions.map(a => (a + 2) % 4); // Return the reverse of the last few actions
}

function update(time) {
    if (time - lastStepTime > stepDelay) {
        lastStepTime = time;
        var action = chooseAction(agentPosition);
        var reward = takeAction(agentPosition, action);
        totalReward += reward;
        updateQTable(agentPosition, action, reward);
        explorationRate = Math.max(explorationRate - explorationDecay, 0.01);
        agent.x = agentPosition.x * tileSize;
        agent.y = agentPosition.y * tileSize;

        // Temporarily increase exploration rate if stuck
        // (I had to do this because the agent can get stuck in a loop sometimes)
        if (samePositionCount > 3) {
            explorationRate = Math.min(explorationRate + 0.1, 1.0);
            samePositionCount = 0;  // Reset the counter
        }

        if (agentPosition.x === goalPosition.x && agentPosition.y === goalPosition.y) {
            console.log('Goal reached! Attempt:', attempt, 'Total Reward:', totalReward);
            
            if (attempt > 1 && totalReward >= maxPossibleReward && lastReward >= maxPossibleReward) {
                consecutiveMaxRewardCount++;
            }
            else {
                consecutiveMaxRewardCount = 0;
            }

            rewardText.setText('Reward: ' + totalReward.toFixed(2));

            // Decay the exploration rate
            // (This is so we can see the agent exploit more as it learns)
            explorationRate = Math.max(explorationRate * epsilonDecay, epsilonMin);

            // Update the reward history and chart after each attempt
            rewardHistory.push(totalReward);
            rewardChart.data.labels.push('Attempt ' + attempt);
            rewardChart.data.datasets.forEach((dataset) => {
                dataset.data.push(totalReward);
            });
            rewardChart.update();

            // Check if the game has been won
            if (consecutiveMaxRewardCount === 5) {
                showWinMessage(attempt);
            }

            lastReward = totalReward; // Track the last reward
            resetAgent(); // Reset agent position after reaching the goal
            totalReward = 0;
            attempt++;
            attemptText.setText('Attempt: ' + attempt);
        }
    }
}

// start again
function resetAgent() {
    // Reset the agent position to the initial state
    agentPosition = { x: 0, y: 7 };
}

// decide on actions
function chooseAction(position) {
    var action;

    // Avoid the action that would reverse the last move
    var avoidActions = lastActions(); // Function to get last few actions to avoid

    if (Math.random() < explorationRate) {
        do {
            action = Math.floor(Math.random() * 4); // Explore
        } while (avoidActions.includes(action));
    } else {
        // Exploit the best-known action, avoiding the reverse of the last actions if possible
        var currentQValues = [...qTable[position.y][position.x]]; // Clone the current Q-values
        avoidActions.forEach(a => currentQValues[a] = Math.min(...currentQValues)); // Discourage reverse actions
        var maxQValue = Math.max(...currentQValues);
        action = currentQValues.indexOf(maxQValue);
    }

    updateLastActions(action); // Update the last actions taken
    return action;
}

// move around looking for our earl grey
function takeAction(position, action) {
    var reward = -0.01;
    var newPosition = { x: position.x, y: position.y };

    // Check if the new position is valid (not an obstacle and within grid bounds)
    function isValidMove(newX, newY) {
        if (newX < 0 || newY < 0 || newX >= gridSize || newY >= gridSize) {
            return false; // Out of grid bounds
        }
        return !obstacles.some(obstacle => obstacle.x / tileSize === newX && obstacle.y / tileSize === newY);
    }

    // Determine new position based on the action
    switch (action) {
        case 0: // Up
            if (isValidMove(position.x, position.y - 1)) newPosition.y -= 1;
            break;
        case 1: // Right
            if (isValidMove(position.x + 1, position.y)) newPosition.x += 1;
            break;
        case 2: // Down
            if (isValidMove(position.x, position.y + 1)) newPosition.y += 1;
            break;
        case 3: // Left
            if (isValidMove(position.x - 1, position.y)) newPosition.x -= 1;
            break;
    }

    if (newPosition.x !== position.x || newPosition.y !== position.y) {
        // Update agent position if it's a valid move
        agentPosition = newPosition;

        if (agentPosition.x === goalPosition.x && agentPosition.y === goalPosition.y) {
            reward = 1; // Reward for reaching the goal
        }
    } else {
        // Invalid move (either out of bounds or into an obstacle)
        reward -= 0.1;
    }

    return reward;
}

// Updating the Q-table
function updateQTable(position, action, reward) {
    var nextState = agentPosition;
    var maxQValueNextState = Math.max(...qTable[nextState.y][nextState.x]);
    qTable[position.y][position.x][action] += learningRate * (reward + discountFactor * maxQValueNextState - qTable[position.y][position.x][action]);
}

